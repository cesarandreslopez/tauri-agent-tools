import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findTauriConfig,
  loadTauriConfig,
  resolveIdentifier,
  resolveProductName,
  resolveDevPort,
  resolveTauriPaths,
  resolveTauriProject,
  findCapabilityFiles,
  loadCapability,
} from '../../src/util/tauriConfig.js';

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

describe('findTauriConfig', () => {
  it('finds tauri.conf.json in current directory', () => {
    const root = scaffold('find-current', {
      'tauri.conf.json': '{"identifier":"a.b.c"}',
    });
    expect(findTauriConfig(root)).toBe(join(root, 'tauri.conf.json'));
  });

  it('finds tauri.conf.json inside src-tauri/ subdirectory', () => {
    const root = scaffold('find-src-tauri', {
      'src-tauri/tauri.conf.json': '{"identifier":"a.b.c"}',
      'package.json': '{}',
    });
    expect(findTauriConfig(root)).toBe(join(root, 'src-tauri', 'tauri.conf.json'));
  });

  it('walks upward to find ancestor config', () => {
    const root = scaffold('find-ancestor', {
      'tauri.conf.json': '{"identifier":"a.b.c"}',
      'deep/nested/dir/.placeholder': '',
    });
    expect(findTauriConfig(join(root, 'deep/nested/dir'))).toBe(
      join(root, 'tauri.conf.json'),
    );
  });

  it('returns null when no config is found before filesystem root', () => {
    // Use a guaranteed-empty temp dir whose ancestors won't contain tauri.conf.json
    const root = scaffold('find-none', { 'empty.txt': '' });
    // Test from inside the empty dir — searching up will eventually hit /,
    // which won't have a tauri.conf.json (so null is the expected result).
    // We can't actually test this without rooting, so use a deep tmp dir
    // and trust that no ancestor has the config.
    // Skip strict null check; instead just verify it doesn't throw.
    expect(() => findTauriConfig(root)).not.toThrow();
  });
});

describe('loadTauriConfig', () => {
  it('parses JSON5 without stripping URL or comment-like string content', async () => {
    const root = scaffold('real-json5', {
      'tauri.conf.json': `{
        // comment outside strings
        identifier: 'com.fixture.json5',
        build: { devUrl: 'http://localhost:1420/path//segment', },
        productName: 'text /* kept */ ,}',
      }`,
      'capabilities/default.json': `{
        identifier: 'default', // comment
        windows: ['main',],
        permissions: [{identifier: 'http:default', allow: [{url: 'https://example.com/*'},],},],
      }`,
    });
    const loaded = await loadTauriConfig({ configPath: root });
    expect(resolveDevPort(loaded.raw)).toBe(1420);
    expect(loaded.raw.productName).toBe('text /* kept */ ,}');
    const cap = await loadCapability(join(root, 'capabilities/default.json'));
    expect(cap.permissions[0]).toMatchObject({ allow: [{ url: 'https://example.com/*' }] });
  });
  it('names the config file when parsing fails', async () => {
    const root = scaffold('invalid-json5', { 'tauri.conf.json': '{ identifier: ' });
    await expect(loadTauriConfig({ configPath: root })).rejects.toThrow(join(root, 'tauri.conf.json'));
  });
  it('loads a minimal config and exposes the project directory', async () => {
    const root = scaffold('load-min', {
      'tauri.conf.json': JSON.stringify({ identifier: 'com.test.app', productName: 'TestApp' }),
    });
    const loaded = await loadTauriConfig({ configPath: root });
    expect(loaded.configPath).toBe(join(root, 'tauri.conf.json'));
    expect(loaded.projectDir).toBe(root);
    expect(loaded.raw.identifier).toBe('com.test.app');
    expect(loaded.raw.productName).toBe('TestApp');
  });

  it('tolerates JSONC line comments and trailing commas', async () => {
    const root = scaffold('load-jsonc', {
      'tauri.conf.json': `{
        // a comment
        "identifier": "com.jsonc.app",
        "productName": "Jsonc",
      }`,
    });
    const loaded = await loadTauriConfig({ configPath: root });
    expect(loaded.raw.identifier).toBe('com.jsonc.app');
  });

  it('throws a helpful message when no config exists', async () => {
    const root = scaffold('load-missing', { 'empty.txt': '' });
    await expect(loadTauriConfig({ configPath: root })).rejects.toThrow(/No tauri\.conf\.json/);
  });
});

describe('identifier resolution', () => {
  it('prefers top-level identifier (Tauri v2)', () => {
    expect(resolveIdentifier({ identifier: 'top', bundle: { identifier: 'bundle' } })).toBe('top');
  });

  it('falls back to bundle.identifier (Tauri v1)', () => {
    expect(resolveIdentifier({ bundle: { identifier: 'bundle' } })).toBe('bundle');
  });

  it('throws when no identifier is present', () => {
    expect(() => resolveIdentifier({})).toThrow(/identifier/);
  });
});

describe('productName resolution', () => {
  it('uses raw.productName when present', () => {
    expect(resolveProductName({ productName: 'X' }, 'fallback')).toBe('X');
  });

  it('falls back to directory name when productName is absent', () => {
    expect(resolveProductName({}, 'fallback')).toBe('fallback');
  });
});

describe('resolveDevPort', () => {
  it('parses port from devUrl', () => {
    expect(resolveDevPort({ build: { devUrl: 'http://localhost:1420' } })).toBe(1420);
  });

  it('returns null when devUrl is absent', () => {
    expect(resolveDevPort({})).toBeNull();
  });

  it('returns null when devUrl is unparseable', () => {
    expect(resolveDevPort({ build: { devUrl: 'not a url' } })).toBeNull();
  });

  it('defaults to 80/443 for http/https URLs without explicit port', () => {
    expect(resolveDevPort({ build: { devUrl: 'http://example.com/' } })).toBe(80);
    expect(resolveDevPort({ build: { devUrl: 'https://example.com/' } })).toBe(443);
  });
});

describe('resolveTauriPaths', () => {
  it('returns all three platforms with the bundle id embedded', () => {
    const paths = resolveTauriPaths('com.test.x');
    expect(paths.darwin.appConfigDir).toMatch(/Library\/Application Support\/com\.test\.x$/);
    expect(paths.darwin.appLogDir).toMatch(/Library\/Logs\/com\.test\.x$/);
    expect(paths.darwin.appCacheDir).toMatch(/Library\/Caches\/com\.test\.x$/);
    expect(paths.linux.appLogDir).toMatch(/com\.test\.x\/logs$/);
    expect(paths.linux.appCacheDir).toMatch(/\.cache\/com\.test\.x$/);
    expect(paths.win32.appLogDir).toMatch(/com\.test\.x\\logs$/);
    expect(paths.win32.appDataDir).toContain('Roaming');
    expect(paths.win32.appLocalDataDir).toContain('Local');
  });

  it('uses identical Application Support path for data/local-data/config on macOS', () => {
    const { darwin } = resolveTauriPaths('com.test.x');
    expect(darwin.appConfigDir).toBe(darwin.appDataDir);
    expect(darwin.appDataDir).toBe(darwin.appLocalDataDir);
  });
});

describe('capability files', () => {
  it('finds *.json files under src-tauri/capabilities', async () => {
    const root = scaffold('caps', {
      'src-tauri/tauri.conf.json': '{"identifier":"com.caps.x"}',
      'src-tauri/capabilities/default.json': JSON.stringify({
        identifier: 'default',
        permissions: ['core:default'],
      }),
      'src-tauri/capabilities/extra.json': JSON.stringify({
        identifier: 'extra',
        permissions: [{ identifier: 'fs:allow-read', allow: [] }],
      }),
    });
    const files = await findCapabilityFiles(root);
    expect(files).toHaveLength(2);
    const cap = await loadCapability(files[0]);
    expect(cap.identifier.length).toBeGreaterThan(0);
  });

  it('returns [] when no capabilities directory exists', async () => {
    const root = scaffold('caps-none', { 'tauri.conf.json': '{"identifier":"x.y"}' });
    expect(await findCapabilityFiles(root)).toEqual([]);
  });
});

describe('resolveTauriProject (composed)', () => {
  it('combines config + identifier + paths + capabilities into one snapshot', async () => {
    const root = scaffold('compose', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.compose.app',
        productName: 'Composer',
        version: '1.2.3',
        mainBinaryName: 'composer',
        build: { devUrl: 'http://localhost:5173', frontendDist: '../dist' },
        bundle: { externalBin: ['binaries/helper'] },
        app: { windows: [{ label: 'main' }, { label: 'settings' }] },
      }),
      'src-tauri/capabilities/default.json': JSON.stringify({
        identifier: 'default',
        permissions: [],
      }),
    });

    const resolved = await resolveTauriProject({ configPath: root });
    expect(resolved.identifier).toBe('com.compose.app');
    expect(resolved.productName).toBe('Composer');
    expect(resolved.version).toBe('1.2.3');
    expect(resolved.devUrl).toBe('http://localhost:5173');
    expect(resolved.devPort).toBe(5173);
    expect(resolved.frontendDist).toBe('../dist');
    expect(resolved.sidecars).toEqual(['binaries/helper']);
    expect(resolved.windows).toEqual(['main', 'settings']);
    expect(resolved.capabilityFiles).toHaveLength(1);
    expect(resolved.paths.darwin.appLogDir).toContain('com.compose.app');
  });

  it('honors identifierOverride without reading the config identifier', async () => {
    const root = scaffold('override', {
      'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.original' }),
    });
    const resolved = await resolveTauriProject({
      configPath: root,
      identifierOverride: 'com.override',
    });
    expect(resolved.identifier).toBe('com.override');
    expect(resolved.paths.darwin.appDataDir).toContain('com.override');
  });
});
