import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const cli = join(process.cwd(), 'dist/cli.js');
describe('CLI error contract', () => {
  it.each([
    ['check'],
    ['wait', '--eval', 'true', '--timeout', '1ms'],
    ['wait', '--selector', 'body', '--eval', 'true'],
    ['eval', '1', '--port', '65536'],
    ['eval', '1', '--file', 'fixture.js'],
    ['logs', '--follow', '--no-bridge'],
    ['click', 'body', '--double', '--right'],
    ['scroll', '--by', '10', '--to', '20'],
    ['dom', '--depth', '-1'],
    ['diff', 'a', 'b', '--threshold', '101'],
    ['not-a-command'],
    ['eval', '1', '--unknown-option'],
  ])('emits one structured error for %j', (...args) => {
    let failure: { status: number; stdout: string; stderr: string } | undefined;
    try { execFileSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { failure = error; }
    expect(failure?.status).toBe(1);
    expect(failure?.stdout).toBe('');
    expect(JSON.parse(failure!.stderr)).toMatchObject({
      error: { code: 'INVALID_ARGUMENT', message: expect.any(String), hint: expect.any(String) },
    });
  });
  it('keeps help successful and human readable with --json present', () => {
    expect(execFileSync(process.execPath, [cli, 'eval', '--help', '--json'], { encoding: 'utf8' })).toContain('--json');
  });
});
