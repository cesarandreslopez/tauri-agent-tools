import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');

let workspace: string;
beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'forensics-test-'));
});
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function scaffold(name: string, files: Record<string, string>): string {
  const root = join(workspace, name);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('forensics command (e2e)', () => {
  it('produces a forensic bundle with summary files', async () => {
    const project = scaffold('basic-project', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.forensics.test',
        productName: 'ForensicsTest',
      }),
    });
    const out = join(workspace, 'basic-out');

    await execFileP('node', [
      CLI,
      'forensics',
      '--config',
      project,
      '-o',
      out,
      '--logs-duration',
      '200',
    ]);

    expect(existsSync(join(out, 'summary.md'))).toBe(true);
    expect(existsSync(join(out, 'summary.json'))).toBe(true);
    expect(existsSync(join(out, 'project.json'))).toBe(true);

    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'));
    expect(summary.identifier).toBe('com.forensics.test');
    expect(summary.productName).toBe('ForensicsTest');
    expect(Array.isArray(summary.phases)).toBe(true);

    const md = readFileSync(join(out, 'summary.md'), 'utf-8');
    expect(md).toContain('com.forensics.test');
    expect(md).toContain('## Phases');
  });

  it('emits a useful summary even when no app-data/log dirs exist', async () => {
    const project = scaffold('empty-project', {
      // identifier deliberately unlikely to collide with anything real on the host
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.forensics.nonexistent-' + Date.now(),
        productName: 'NonexistentApp',
      }),
    });
    const out = join(workspace, 'empty-out');

    await execFileP('node', [
      CLI,
      'forensics',
      '--config',
      project,
      '-o',
      out,
      '--logs-duration',
      '200',
    ]);

    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'));
    // At least one phase ran (resolve-config); list-app-data may have failed.
    const phaseNames = summary.phases.map((p: { phase: string }) => p.phase);
    expect(phaseNames).toContain('resolve-config');
    expect(phaseNames).toContain('list-app-data');
    // App-data list should report "does not exist" since we never created it.
    const dataPhase = summary.phases.find((p: { phase: string }) => p.phase === 'list-app-data');
    expect(dataPhase.ok).toBe(false);

    const md = readFileSync(join(out, 'summary.md'), 'utf-8');
    expect(md).toContain('Suggested next steps');
  });

  it('errors clearly when the config does not exist', async () => {
    await expect(
      execFileP('node', [
        CLI,
        'forensics',
        '--config',
        join(workspace, 'no-such-dir'),
        '-o',
        join(workspace, 'never-out'),
      ]),
    ).rejects.toMatchObject({ code: expect.any(Number) });
  });

  it('--json prints the summary to stdout in addition to writing files', async () => {
    const project = scaffold('json-project', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.forensics.json',
        productName: 'JsonForensics',
      }),
    });
    const out = join(workspace, 'json-out');

    const { stdout } = await execFileP('node', [
      CLI,
      'forensics',
      '--config',
      project,
      '-o',
      out,
      '--json',
      '--logs-duration',
      '200',
    ]);
    const parsed = JSON.parse(stdout);
    expect(parsed.identifier).toBe('com.forensics.json');
    expect(parsed.outDir).toBe(out);
  });
});
