import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAppPaths } from '../../src/commands/appPaths.js';

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'tauri-agent-tools-test-'));
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

function buildProgram() {
  const program = new Command();
  program.exitOverride();
  registerAppPaths(program);
  return program;
}

function captureJson(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    lines.push(String(s));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('app-paths command', () => {
  it('emits JSON for current platform by default', async () => {
    const root = scaffold('paths-current', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.paths.current',
        productName: 'PathsCurrent',
      }),
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'app-paths', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      expect(out.identifier).toBe('com.paths.current');
      expect(out.productName).toBe('PathsCurrent');
      const platforms = Object.keys(out.paths);
      expect(platforms).toHaveLength(1);
    } finally {
      cap.restore();
    }
  });

  it('returns all three platforms with --platform all', async () => {
    const root = scaffold('paths-all', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.paths.all' }),
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync([
        'node',
        't',
        'app-paths',
        '--config',
        root,
        '--platform',
        'all',
        '--json',
      ]);
      const out = JSON.parse(cap.lines.join('\n'));
      expect(Object.keys(out.paths).sort()).toEqual(['darwin', 'linux', 'win32']);
      expect(out.paths.darwin.appLogDir).toContain('com.paths.all');
      expect(out.paths.linux.appLogDir).toContain('com.paths.all');
      expect(out.paths.win32.appLogDir).toContain('com.paths.all');
    } finally {
      cap.restore();
    }
  });

  it('--identifier without --config skips tauri.conf.json lookup', async () => {
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync([
        'node',
        't',
        'app-paths',
        '--identifier',
        'com.bare.app',
        '--platform',
        'darwin',
        '--json',
      ]);
      const out = JSON.parse(cap.lines.join('\n'));
      expect(out.identifier).toBe('com.bare.app');
      expect(out.productName).toBeNull();
      expect(out.configPath).toBeNull();
      const darwinHome = process.platform === 'darwin' ? process.env.HOME : '/Users/<user>';
      expect(out.paths.darwin.appLogDir).toBe(
        `${darwinHome}/Library/Logs/com.bare.app`,
      );
    } finally {
      cap.restore();
    }
  });

  it('--identifier with --config overrides the config-declared identifier', async () => {
    const root = scaffold('paths-override', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.original' }),
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync([
        'node',
        't',
        'app-paths',
        '--config',
        root,
        '--identifier',
        'com.override',
        '--json',
      ]);
      const out = JSON.parse(cap.lines.join('\n'));
      expect(out.identifier).toBe('com.override');
    } finally {
      cap.restore();
    }
  });

  it('rejects invalid --platform values', async () => {
    const root = scaffold('paths-invalid', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'a.b.c' }),
    });
    const program = buildProgram();
    await expect(
      program.parseAsync([
        'node',
        't',
        'app-paths',
        '--config',
        root,
        '--platform',
        'haiku',
      ]),
    ).rejects.toThrow(/Invalid --platform/);
  });

  it('annotates existence when --exists is passed', async () => {
    const root = scaffold('paths-exists', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.exists.test' }),
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync([
        'node',
        't',
        'app-paths',
        '--config',
        root,
        '--exists',
        '--json',
      ]);
      const out = JSON.parse(cap.lines.join('\n'));
      const current = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
      const sample = out.paths[current].appLogDir as string;
      expect(sample).toMatch(/\((dir exists|file exists|missing)\)$/);
    } finally {
      cap.restore();
    }
  });
});
