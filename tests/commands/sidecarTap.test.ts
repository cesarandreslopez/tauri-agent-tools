import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');

let workspace: string;
beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sidecar-tap-test-'));
});
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writeFake(name: string, body: string): string {
  const path = join(workspace, name);
  writeFileSync(path, body);
  return path;
}

const FAKE_SIDECAR = `
const lines = [
  '{"ts":1700000000,"level":"info","msg":"a"}',
  '{"ts":1700000001,"level":"warn","msg":"b"}',
  'not valid json',
  '{"ts":1700000002,"level":"info","msg":"c"}',
];
for (const l of lines) console.log(l);
`;

describe('sidecar tap command (e2e)', () => {
  it('emits one envelope per stdout line, with valid/invalid markers', async () => {
    const sidecar = writeFake('fake.mjs', FAKE_SIDECAR);
    const { stdout, stderr } = await execFileP('node', [CLI, 'sidecar', 'tap', '--', 'node', sidecar]);
    const envelopes = stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(envelopes).toHaveLength(4);
    expect(envelopes[0]).toMatchObject({
      direction: 'sidecar→',
      valid: true,
      payload: { ts: 1700000000, level: 'info', msg: 'a' },
    });
    expect(envelopes[2]).toMatchObject({
      direction: 'sidecar→',
      valid: false,
      rawLine: 'not valid json',
    });
    expect(stderr).toContain('envelopes=4');
    expect(stderr).toContain('invalid=1');
  });

  it('validates payloads against a user-provided JSON Schema', async () => {
    const sidecar = writeFake('schema-fake.mjs', FAKE_SIDECAR);
    const schemaPath = writeFake(
      'schema.json',
      JSON.stringify({
        type: 'object',
        required: ['ts', 'level'],
        properties: { ts: { type: 'number' }, level: { enum: ['info'] } },
      }),
    );
    const { stdout } = await execFileP('node', [
      CLI,
      'sidecar',
      'tap',
      '--schema',
      schemaPath,
      '--',
      'node',
      sidecar,
    ]);
    const envelopes = stdout.trim().split('\n').map((l) => JSON.parse(l));
    // 1st (info) → valid; 2nd (warn) → invalid (level enum mismatch); 4th (info) → valid
    expect(envelopes[0].valid).toBe(true);
    expect(envelopes[1].valid).toBe(false);
    expect(envelopes[1].schemaErrors).toBeDefined();
    expect(envelopes[3].valid).toBe(true);
  });

  it('records the raw NDJSON stream to a file with --record', async () => {
    const sidecar = writeFake('rec-fake.mjs', FAKE_SIDECAR);
    const recordPath = join(workspace, 'recording.ndjson');
    await execFileP('node', [CLI, 'sidecar', 'tap', '--record', recordPath, '--', 'node', sidecar]);
    const recorded = readFileSync(recordPath, 'utf-8').trim().split('\n');
    expect(recorded).toHaveLength(4);
    expect(recorded[0]).toBe('{"ts":1700000000,"level":"info","msg":"a"}');
    expect(recorded[2]).toBe('not valid json');
  });

  it('--raw echoes the sidecar stdout verbatim', async () => {
    const sidecar = writeFake('raw-fake.mjs', FAKE_SIDECAR);
    const { stdout } = await execFileP('node', [CLI, 'sidecar', 'tap', '--raw', '--', 'node', sidecar]);
    expect(stdout).toContain('{"ts":1700000000,"level":"info","msg":"a"}');
    expect(stdout).toContain('not valid json');
  });

  it('exits non-zero when the sidecar exec is missing', async () => {
    await expect(
      execFileP('node', [CLI, 'sidecar', 'tap', '--', 'nonexistent-binary-zzzz']),
    ).rejects.toMatchObject({
      // commander prints to stderr; the process exits non-zero
      code: expect.any(Number),
    });
  });
});
