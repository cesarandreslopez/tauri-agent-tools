import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerConfigInspect } from '../../src/commands/configInspect.js';

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
  registerConfigInspect(program);
  return program;
}

function captureJson(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    lines.push(String(s));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('config inspect command', () => {
  it('emits a structured snapshot with capability summary', async () => {
    const root = scaffold('inspect-basic', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.test.app',
        productName: 'TestApp',
        version: '1.0.0',
        build: { devUrl: 'http://localhost:1420', frontendDist: '../dist' },
        app: { windows: [{ label: 'main' }] },
      }),
      'src-tauri/capabilities/default.json': JSON.stringify({
        identifier: 'default',
        description: 'core',
        windows: ['main'],
        permissions: ['core:default', 'fs:allow-read'],
      }),
      'src-tauri/Cargo.toml': `
[dependencies]
tauri = "2"
tauri-plugin-fs = "2"
`,
    });

    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'config', 'inspect', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      expect(out.identifier).toBe('com.test.app');
      expect(out.devPort).toBe(1420);
      expect(out.capabilities).toHaveLength(1);
      expect(out.capabilities[0].permissions).toEqual([
        { identifier: 'core:default', hasAllow: false, hasDeny: false },
        { identifier: 'fs:allow-read', hasAllow: false, hasDeny: false },
      ]);
      expect(out.declaredPlugins).toContain('tauri-plugin-fs');
      // No warnings: fs permission is matched by tauri-plugin-fs in Cargo.toml
      expect(out.warnings).toEqual([]);
    } finally {
      cap.restore();
    }
  });

  it('flags wildcard "*" permission as an error', async () => {
    const root = scaffold('inspect-wildcard', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.test.wild' }),
      'src-tauri/capabilities/wide.json': JSON.stringify({
        identifier: 'wide',
        permissions: ['*'],
      }),
      'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"\n',
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'config', 'inspect', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      const errors = out.warnings.filter((w: { level: string }) => w.level === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('wildcard');
    } finally {
      cap.restore();
    }
  });

  it('flags over-broad fs:allow-all', async () => {
    const root = scaffold('inspect-broad', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.test.broad' }),
      'src-tauri/capabilities/broad.json': JSON.stringify({
        identifier: 'broad',
        permissions: ['fs:allow-all'],
      }),
      'src-tauri/Cargo.toml': '[dependencies]\ntauri-plugin-fs = "2"\n',
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'config', 'inspect', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      const warns = out.warnings.filter((w: { level: string }) => w.level === 'warn');
      expect(warns.some((w: { message: string }) => w.message.includes('fs:allow-all'))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it('warns when a capability references a plugin not in Cargo.toml', async () => {
    const root = scaffold('inspect-missing-plugin', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.test.missing' }),
      'src-tauri/capabilities/c.json': JSON.stringify({
        identifier: 'c',
        permissions: ['notification:default'],
      }),
      'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"\n',
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'config', 'inspect', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      const warns = out.warnings.filter((w: { level: string }) => w.level === 'warn');
      expect(
        warns.some((w: { message: string }) => w.message.includes('tauri-plugin-notification')),
      ).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it('records a parse error for malformed capability files', async () => {
    const root = scaffold('inspect-malformed', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.test.bad' }),
      'src-tauri/capabilities/broken.json': '{ not valid json',
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'config', 'inspect', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      const errors = out.warnings.filter((w: { level: string }) => w.level === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(out.capabilities[0].identifier).toBe('<parse-error>');
    } finally {
      cap.restore();
    }
  });

  it('warns when externalBin sidecars are declared but tauri-plugin-shell is missing', async () => {
    const root = scaffold('inspect-sidecar', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.test.sidecar',
        bundle: { externalBin: ['binaries/helper'] },
      }),
      'src-tauri/capabilities/c.json': JSON.stringify({
        identifier: 'c',
        permissions: [],
      }),
      'src-tauri/Cargo.toml': '[dependencies]\ntauri-plugin-fs = "2"\n',
    });
    const program = buildProgram();
    const cap = captureJson();
    try {
      await program.parseAsync(['node', 't', 'config', 'inspect', '--config', root, '--json']);
      const out = JSON.parse(cap.lines.join('\n'));
      expect(
        out.warnings.some((w: { message: string }) =>
          w.message.includes('tauri-plugin-shell'),
        ),
      ).toBe(true);
    } finally {
      cap.restore();
    }
  });
});
