import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');

let workspace: string;
beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sidecar-replay-test-'));
});
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writeRecording(name: string, lines: string[]): string {
  const path = join(workspace, name);
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

describe('sidecar replay command (e2e)', () => {
  it('emits each recorded line to stdout in order', async () => {
    const recording = writeRecording('basic.ndjson', [
      '{"i":0}',
      '{"i":1}',
      '{"i":2}',
    ]);
    const { stdout } = await execFileP('node', [CLI, 'sidecar', 'replay', recording, '--to-stdout']);
    const lines = stdout.trim().split('\n');
    expect(lines).toEqual(['{"i":0}', '{"i":1}', '{"i":2}']);
  });

  it('skips blank lines in the recording', async () => {
    const recording = writeRecording('blanks.ndjson', ['{"i":0}', '', '{"i":1}']);
    const { stdout } = await execFileP('node', [CLI, 'sidecar', 'replay', recording, '--to-stdout']);
    expect(stdout.trim().split('\n')).toEqual(['{"i":0}', '{"i":1}']);
  });

  it('throws when the recording file is missing', async () => {
    await expect(
      execFileP('node', [CLI, 'sidecar', 'replay', join(workspace, 'nope.ndjson'), '--to-stdout']),
    ).rejects.toMatchObject({ code: expect.any(Number) });
  });

  it('rate-limits with --rate', async () => {
    const recording = writeRecording('rated.ndjson', ['a', 'b', 'c', 'd']);
    const t0 = Date.now();
    // 20 lps × 4 lines ≈ 200ms; allow generous slack for CI scheduler jitter
    await execFileP('node', [CLI, 'sidecar', 'replay', recording, '--to-stdout', '--rate', '20']);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(150);
  }, 5000);

  it('pipes lines into a child via --to-exec', async () => {
    const recording = writeRecording('pipe.ndjson', ['{"i":0}', '{"i":1}']);
    // Use `cat` to echo stdin back; verify it sees both lines
    const { stdout } = await execFileP('node', [
      CLI,
      'sidecar',
      'replay',
      recording,
      '--to-exec',
      'cat',
    ]);
    expect(stdout.trim().split('\n')).toEqual(['{"i":0}', '{"i":1}']);
  });

  it('unwraps tap-format lines and filters by direction', async () => {
    const inbound = '{"jsonrpc":"2.0","method":"run","id":1}';
    const outbound = '{"jsonrpc":"2.0","result":{"ok":true},"id":1}';
    const recording = writeRecording('tap.ndjson', [
      JSON.stringify({ dir: 'in', ts: '2026-07-03T08:00:00.000Z', line: inbound }),
      JSON.stringify({ dir: 'out', ts: '2026-07-03T08:00:01.000Z', line: outbound }),
    ]);

    const { stdout } = await execFileP('node', [
      CLI,
      'sidecar',
      'replay',
      recording,
      '--tap-format',
      '--dir',
      'in',
      '--to-stdout',
    ]);

    expect(stdout.trim().split('\n')).toEqual([inbound]);
  });

  it('rejects malformed tap-format lines with the expected wrapper shape', async () => {
    const recording = writeRecording('bad-tap.ndjson', ['{"dir":"in","line":7}']);

    await expect(
      execFileP('node', [CLI, 'sidecar', 'replay', recording, '--tap-format', '--to-stdout']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('expected tap wrapper with dir "in"|"out", ts string, and line string'),
    });
  });
});
