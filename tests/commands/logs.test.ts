import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'logs-test-'));
  // ISO-timestamped source
  await writeFile(
    join(dir, 'rust.log'),
    '[2026-06-19T18:00:01.500Z][app::db][INFO] opened run_id=abc\n' +
      '[2026-06-19T18:00:03.000Z][app::db][ERROR] failed run_id=abc\n',
  );
  // split date/time source whose entry interleaves between the rust entries
  await writeFile(
    join(dir, 'sidecar.log'),
    '[2026-06-19][18:00:02][sidecar][WARN] drained requestId=req-9\n',
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('logs (e2e via dist/cli.js)', () => {
  it('merges multiple files into one timestamp-ordered NDJSON stream', async () => {
    const { stdout } = await execFileP('node', [CLI, 'logs', '--log-dir', dir, '--no-bridge']);
    const rows = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(rows.map((r) => r.message)).toEqual([
      'opened run_id=abc',
      'drained requestId=req-9',
      'failed run_id=abc',
    ]);
    expect(rows.map((r) => r.source)).toEqual(['file:rust.log', 'file:sidecar.log', 'file:rust.log']);
  });

  it('--level filters by minimum severity', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'logs',
      '--log-dir',
      dir,
      '--no-bridge',
      '--level',
      'error',
    ]);
    const rows = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe('error');
  });

  it('--correlate infers ids into a correlation field', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'logs',
      '--log-dir',
      dir,
      '--no-bridge',
      '--correlate',
      '--filter',
      'drained',
    ]);
    const rows = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].correlation).toEqual({ requestId: 'req-9' });
  });
});
