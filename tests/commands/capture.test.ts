import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlatformAdapter, WindowInfo } from '../../src/types.js';
import { CaptureManifestSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/util/magick.js', () => ({
  magickCommand: vi.fn((sub: string) => Promise.resolve({ bin: sub, args: [] })),
}));

import { writeFile, mkdir } from 'node:fs/promises';

const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

function createMockAdapter(overrides?: Partial<PlatformAdapter>): PlatformAdapter {
  return {
    findWindow: vi.fn().mockResolvedValue('12345'),
    captureWindow: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    getWindowGeometry: vi.fn().mockResolvedValue({
      windowId: '12345', x: 0, y: 0, width: 1920, height: 1110,
    } satisfies WindowInfo),
    getWindowName: vi.fn().mockResolvedValue('Test App'),
    listWindows: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ─── Schema tests ────────────────────────────────────────────────────────────

describe('CaptureManifestSchema', () => {
  it('accepts full data', () => {
    const manifest = {
      timestamp: '2026-04-03T00:00:00.000Z',
      url: 'http://localhost:1420',
      title: 'My App',
      viewport: { width: 1920, height: 1080 },
      errorCount: 0,
      files: {
        'screenshot.png': '/tmp/cap/screenshot.png',
        'dom.json': '/tmp/cap/dom.json',
      },
    };
    expect(CaptureManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('accepts minimal data (only required fields)', () => {
    const manifest = {
      timestamp: '2026-04-03T00:00:00.000Z',
      files: {},
    };
    const parsed = CaptureManifestSchema.parse(manifest);
    expect(parsed.timestamp).toBe('2026-04-03T00:00:00.000Z');
    expect(parsed.files).toEqual({});
    expect(parsed.url).toBeUndefined();
    expect(parsed.title).toBeUndefined();
    expect(parsed.viewport).toBeUndefined();
    expect(parsed.errorCount).toBeUndefined();
  });

  it('accepts manifest with error entries in files', () => {
    const manifest = {
      timestamp: '2026-04-03T00:00:00.000Z',
      errorCount: 2,
      files: {
        'screenshot.png': 'error: Could not find window',
        'dom.json': '/tmp/cap/dom.json',
        'rust-logs.json': 'error: Bridge does not support /logs',
      },
    };
    const parsed = CaptureManifestSchema.parse(manifest);
    expect(parsed.errorCount).toBe(2);
    expect(parsed.files['screenshot.png']).toBe('error: Could not find window');
  });

  it('rejects missing timestamp', () => {
    expect(() => CaptureManifestSchema.parse({ files: {} })).toThrow();
  });

  it('rejects missing files', () => {
    expect(() => CaptureManifestSchema.parse({ timestamp: '2026-04-03T00:00:00.000Z' })).toThrow();
  });

  it('rejects non-string file values', () => {
    expect(() =>
      CaptureManifestSchema.parse({
        timestamp: '2026-04-03T00:00:00.000Z',
        files: { 'screenshot.png': 42 },
      }),
    ).toThrow();
  });

  it('accepts partial optional fields', () => {
    const manifest = {
      timestamp: '2026-04-03T00:00:00.000Z',
      url: 'http://localhost',
      files: { 'dom.json': '/out/dom.json' },
    };
    const parsed = CaptureManifestSchema.parse(manifest);
    expect(parsed.url).toBe('http://localhost');
    expect(parsed.title).toBeUndefined();
    expect(parsed.viewport).toBeUndefined();
  });
});

// ─── Command integration tests ────────────────────────────────────────────────

describe('Capture command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates output directory', async () => {
    const pageState = JSON.stringify({
      url: 'http://localhost:1420',
      title: 'Test App',
      viewport: { width: 1920, height: 1080 },
      scroll: { x: 0, y: 0 },
      document: { width: 1920, height: 2000 },
      hasTauri: true,
    });
    const domTree = JSON.stringify({ tag: 'body', rect: { width: 1920, height: 1080 } });
    const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

    let callCount = 0;
    // Calls: inject-errors, page-state, window-title, DOM, storage, drain-errors, (rust-logs via fetchLogs POST)
    const evalResponses = ['ok', pageState, 'Test App', domTree, storage, '[]'];
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/logs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: [] }),
        });
      }
      const result = evalResponses[callCount++];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerCapture } = await import('../../src/commands/capture.js');
    const program = new Command();
    program.exitOverride();
    const adapter = createMockAdapter();
    registerCapture(program, () => adapter);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'capture', '-o', '/tmp/cap', '--logs-duration', '0']);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/cap', { recursive: true });
  });

  it('writes expected artifact files', async () => {
    const pageState = JSON.stringify({
      url: 'http://localhost:1420',
      title: 'Test App',
      viewport: { width: 1920, height: 1080 },
      scroll: { x: 0, y: 0 },
      document: { width: 1920, height: 2000 },
      hasTauri: true,
    });
    const domTree = JSON.stringify({ tag: 'body', rect: { width: 1920, height: 1080 } });
    const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

    let callCount = 0;
    const evalResponses = ['ok', pageState, 'Test App', domTree, storage, '[]'];
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/logs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: [] }),
        });
      }
      const result = evalResponses[callCount++];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerCapture } = await import('../../src/commands/capture.js');
    const program = new Command();
    program.exitOverride();
    const adapter = createMockAdapter();
    registerCapture(program, () => adapter);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'capture', '-o', '/tmp/cap2', '--logs-duration', '0']);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    const writtenPaths = mockWriteFile.mock.calls.map(c => String(c[0]));
    expect(writtenPaths.some(p => p.endsWith('screenshot.png'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('dom.json'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('page-state.json'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('storage.json'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('console-errors.json'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('rust-logs.json'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('manifest.json'))).toBe(true);
  });

  it('outputs JSON manifest when --json flag is set', async () => {
    const pageState = JSON.stringify({
      url: 'http://localhost:1420',
      title: 'App',
      viewport: { width: 1920, height: 1080 },
      scroll: { x: 0, y: 0 },
      document: { width: 1920, height: 1080 },
      hasTauri: false,
    });
    const domTree = JSON.stringify({ tag: 'body', rect: { width: 1920, height: 1080 } });
    const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

    let callCount = 0;
    const evalResponses = ['ok', pageState, 'App', domTree, storage, '[]'];
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/logs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: [] }),
        });
      }
      const result = evalResponses[callCount++];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerCapture } = await import('../../src/commands/capture.js');
    const program = new Command();
    program.exitOverride();
    const adapter = createMockAdapter();
    registerCapture(program, () => adapter);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'capture', '-o', '/tmp/cap3', '--json', '--logs-duration', '0']);

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    expect(output.timestamp).toBeDefined();
    expect(output.url).toBe('http://localhost:1420');
    expect(output.title).toBe('App');
    expect(output.viewport).toEqual({ width: 1920, height: 1080 });
    expect(output.files).toBeDefined();
    expect(output.files['screenshot.png']).toMatch(/screenshot\.png$/);
  });

  it('records errors for failed sub-steps without crashing', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/logs')) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
      }
      callCount++;
      if (callCount === 1) {
        // inject-console-errors OK
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: 'ok' }) });
      }
      // All subsequent bridge evals fail (page-state, dom, storage, drain-errors)
      return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Internal error') });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerCapture } = await import('../../src/commands/capture.js');
    const program = new Command();
    program.exitOverride();
    const adapter = createMockAdapter();
    registerCapture(program, () => adapter);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Use --title so screenshot doesn't need bridge.getDocumentTitle() (avoids extra eval call)
    await program.parseAsync(['node', 'test', 'capture', '-o', '/tmp/caperr', '--json', '--logs-duration', '0', '--title', 'Test App']);

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    // Screenshot should succeed (adapter mock is fine, --title skips eval)
    expect(output.files['screenshot.png']).toMatch(/screenshot\.png$/);
    // page-state, DOM and storage should fail
    expect(output.files['page-state.json']).toMatch(/^error:/);
    expect(output.files['dom.json']).toMatch(/^error:/);
    expect(output.files['storage.json']).toMatch(/^error:/);
    // rust-logs fails because 404
    expect(output.files['rust-logs.json']).toMatch(/^error:/);
    // errorCount should reflect failures
    expect(output.errorCount).toBeGreaterThan(0);
  });

  it('writes eval.json when --eval is provided', async () => {
    const pageState = JSON.stringify({
      url: 'http://localhost', title: 'T',
      viewport: { width: 100, height: 100 },
      scroll: { x: 0, y: 0 },
      document: { width: 100, height: 100 },
      hasTauri: false,
    });
    const domTree = JSON.stringify({ tag: 'body', rect: { width: 100, height: 100 } });
    const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });
    const evalResult = JSON.stringify({ custom: 'data' });

    let callCount = 0;
    const evalResponses = ['ok', pageState, 'T', domTree, storage, '[]', evalResult];
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/logs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [] }) });
      }
      const result = evalResponses[callCount++];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ result }) });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerCapture } = await import('../../src/commands/capture.js');
    const program = new Command();
    program.exitOverride();
    const adapter = createMockAdapter();
    registerCapture(program, () => adapter);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'capture', '-o', '/tmp/capeval', '--eval', 'customFn()', '--logs-duration', '0']);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    const writtenPaths = mockWriteFile.mock.calls.map(c => String(c[0]));
    expect(writtenPaths.some(p => p.endsWith('eval.json'))).toBe(true);
  });
});
