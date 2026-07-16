import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { exec } from '../../src/util/exec.js';
import { registerBundle } from '../../src/commands/bundle.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
}));

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerBundle(program);
  return program;
}

class MockChild extends EventEmitter {
  readonly stdout = streamEmitter();
  readonly stderr = streamEmitter();
}

function streamEmitter(): EventEmitter & { setEncoding: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
}

function childWithResult(stdout = '', stderr = '', code = 0): MockChild {
  const child = new MockChild();
  queueMicrotask(() => {
    if (stdout !== '') child.stdout.emit('data', stdout);
    if (stderr !== '') child.stderr.emit('data', stderr);
    child.emit('close', code);
  });
  return child;
}

describe('bundle command', () => {
  let dir: string | null = null;
  const spawnMock = vi.mocked(spawn);
  const execMock = vi.mocked(exec);

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function tempDir(): string {
    dir = mkdtempSync(join(tmpdir(), 'bundle-command-'));
    return dir;
  }

  it('composes child commands through the CLI path and redacts text artifacts', async () => {
    const root = tempDir();
    const out = join(root, 'incident');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    spawnMock.mockImplementation((_command, args) => {
      const phase = Array.isArray(args) ? String(args[1] ?? 'unknown') : 'unknown';
      return childWithResult(JSON.stringify({ phase, token: 'secret-token' }) + '\n') as never;
    });

    await createProgram().parseAsync([
      'node',
      'test',
      'bundle',
      '--out',
      out,
      '--config',
      'apps/desktop/src-tauri/tauri.conf.json',
      '--identifier',
      'com.example.test',
      '--port',
      '1777',
      '--token',
      'bridge-token',
      '--with-capture',
      '--no-archive',
      '--json',
    ]);

    expect(spawnMock).toHaveBeenCalledTimes(5);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      expect.arrayContaining([
        process.argv[1],
        'logs',
        '--json',
        '--config',
        'apps/desktop/src-tauri/tauri.conf.json',
        '--identifier',
        'com.example.test',
        '--port',
        '1777',
        '--token',
        'bridge-token',
      ]),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      expect.arrayContaining(['capture', '-o', join(out, 'capture'), '--json']),
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    expect(execMock).not.toHaveBeenCalled();
    expect(readFileSync(join(out, 'logs.ndjson'), 'utf-8')).toContain('"token":"[REDACTED]"');

    const summary = JSON.parse(lines.join('\n')) as { archive?: string | null; total?: number };
    expect(summary).toMatchObject({ archive: null, total: 6 });
  });

  it('reports archive failures without failing the bundle', async () => {
    const root = tempDir();
    const out = join(root, 'incident');
    spawnMock.mockImplementation(() => childWithResult('{}\n') as never);
    execMock.mockRejectedValue(new Error('tar unavailable'));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    await createProgram().parseAsync(['node', 'test', 'bundle', '--out', out, '--json']);

    const summary = JSON.parse(lines.join('\n')) as {
      archive?: string | null;
      createdPhases?: Array<{ phase?: string; ok?: boolean; detail?: string }>;
    };
    expect(summary.archive).toBeNull();
    expect(summary.createdPhases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'archive',
          ok: false,
          detail: expect.stringContaining('tar unavailable'),
        }),
      ]),
    );
  });
});
