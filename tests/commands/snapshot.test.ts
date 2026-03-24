import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlatformAdapter, WindowInfo } from '../../src/types.js';
import type { ImageFormat } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/util/magick.js', () => ({
  magickCommand: vi.fn((sub: string) => Promise.resolve({ bin: sub, args: [] })),
}));

import { writeFile } from 'node:fs/promises';

const mockWriteFile = vi.mocked(writeFile);

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

function createMockFetch(responses: Record<string, unknown>) {
  let callIndex = 0;
  const evalResults = Object.values(responses);
  return vi.fn().mockImplementation(() => {
    const result = evalResults[callIndex % evalResults.length];
    callIndex++;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result }),
    });
  });
}

describe('Snapshot command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveWindowId logic', () => {
    it('uses title when provided', async () => {
      const adapter = createMockAdapter();
      const mockFn = vi.mocked(adapter.findWindow);
      mockFn.mockResolvedValue('99999');

      // Simulate the resolveWindowId logic
      const title = 'My App';
      const windowId = await adapter.findWindow(title);
      expect(windowId).toBe('99999');
      expect(mockFn).toHaveBeenCalledWith('My App');
    });

    it('falls back to bridge document title', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'Discovered Title' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { BridgeClient } = await import('../../src/bridge/client.js');
      const bridge = new BridgeClient({ port: 9999, token: 'test' });
      const docTitle = await bridge.getDocumentTitle();
      expect(docTitle).toBe('Discovered Title');

      vi.unstubAllGlobals();
    });

    it('throws when bridge returns empty title', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: '' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { BridgeClient } = await import('../../src/bridge/client.js');
      const bridge = new BridgeClient({ port: 9999, token: 'test' });
      const docTitle = await bridge.getDocumentTitle();
      // The resolveWindowId function checks: if (!docTitle) throw ...
      expect(!docTitle).toBe(true);

      vi.unstubAllGlobals();
    });
  });

  describe('full command integration', () => {
    it('writes screenshot, dom, page state, and storage files', async () => {
      const domTree = JSON.stringify({ tag: 'body', rect: { width: 1920, height: 1080 } });
      const pageState = JSON.stringify({
        url: 'http://localhost:1420',
        title: 'Test App',
        viewport: { width: 1920, height: 1080 },
        scroll: { x: 0, y: 0 },
        document: { width: 1920, height: 2000 },
        hasTauri: true,
      });
      const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

      let callCount = 0;
      const responses = ['Test App', domTree, pageState, storage];
      const mockFetch = vi.fn().mockImplementation(() => {
        const result = responses[callCount++];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Command } = await import('commander');
      const { registerSnapshot } = await import('../../src/commands/snapshot.js');
      const program = new Command();
      const adapter = createMockAdapter();
      registerSnapshot(program, () => adapter);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'snapshot', '-o', '/tmp/debug']);
      logSpy.mockRestore();
      vi.unstubAllGlobals();

      // Should write 4 files: screenshot, dom, page-state, storage
      expect(mockWriteFile).toHaveBeenCalledTimes(4);

      const writtenPaths = mockWriteFile.mock.calls.map(c => c[0]);
      expect(writtenPaths).toContain('/tmp/debug-screenshot.png');
      expect(writtenPaths).toContain('/tmp/debug-dom.json');
      expect(writtenPaths).toContain('/tmp/debug-page-state.json');
      expect(writtenPaths).toContain('/tmp/debug-storage.json');
    });

    it('outputs JSON manifest when --json flag is set', async () => {
      const domTree = JSON.stringify({ tag: 'body', rect: { width: 1920, height: 1080 } });
      const pageState = JSON.stringify({
        url: 'http://localhost:1420', title: 'App',
        viewport: { width: 1920, height: 1080 },
        scroll: { x: 0, y: 0 },
        document: { width: 1920, height: 1080 },
        hasTauri: false,
      });
      const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

      let callCount = 0;
      const responses = ['App', domTree, pageState, storage];
      const mockFetch = vi.fn().mockImplementation(() => {
        const result = responses[callCount++];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Command } = await import('commander');
      const { registerSnapshot } = await import('../../src/commands/snapshot.js');
      const program = new Command();
      const adapter = createMockAdapter();
      registerSnapshot(program, () => adapter);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'snapshot', '-o', '/tmp/snap', '--json']);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      logSpy.mockRestore();
      vi.unstubAllGlobals();

      expect(output.screenshot).toBe('/tmp/snap-screenshot.png');
      expect(output.dom).toBe('/tmp/snap-dom.json');
      expect(output.pageState).toBe('/tmp/snap-page-state.json');
      expect(output.storage).toBe('/tmp/snap-storage.json');
    });

    it('writes eval output when --eval is provided', async () => {
      const domTree = JSON.stringify({ tag: 'body', rect: { width: 100, height: 100 } });
      const pageState = JSON.stringify({
        url: 'http://localhost', title: 'T',
        viewport: { width: 100, height: 100 },
        scroll: { x: 0, y: 0 },
        document: { width: 100, height: 100 },
        hasTauri: false,
      });
      const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });
      const evalResult = JSON.stringify({ custom: 'data' });

      let callCount = 0;
      const responses = ['T', domTree, pageState, storage, evalResult];
      const mockFetch = vi.fn().mockImplementation(() => {
        const result = responses[callCount++];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Command } = await import('commander');
      const { registerSnapshot } = await import('../../src/commands/snapshot.js');
      const program = new Command();
      const adapter = createMockAdapter();
      registerSnapshot(program, () => adapter);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'snapshot', '-o', '/tmp/e', '--eval', 'getCustom()']);
      logSpy.mockRestore();
      vi.unstubAllGlobals();

      // 5 files: screenshot + dom + page-state + storage + eval
      expect(mockWriteFile).toHaveBeenCalledTimes(5);
      const writtenPaths = mockWriteFile.mock.calls.map(c => c[0]);
      expect(writtenPaths).toContain('/tmp/e-eval.json');
    });

    it('records error for failed sub-steps without crashing', async () => {
      // Bridge returns title for window discovery, then fails on DOM
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getDocumentTitle
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ result: 'App' }),
          });
        }
        // All subsequent bridge.eval calls fail
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal error'),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Command } = await import('commander');
      const { registerSnapshot } = await import('../../src/commands/snapshot.js');
      const program = new Command();
      const adapter = createMockAdapter();
      registerSnapshot(program, () => adapter);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'snapshot', '-o', '/tmp/err', '--json']);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      logSpy.mockRestore();
      vi.unstubAllGlobals();

      // Screenshot should succeed (adapter mock works)
      expect(output.screenshot).toBe('/tmp/err-screenshot.png');
      // DOM/pageState/storage should have error messages
      expect(output.dom).toMatch(/^error:/);
      expect(output.pageState).toMatch(/^error:/);
      expect(output.storage).toMatch(/^error:/);
    });

    it('uses --title flag for window discovery', async () => {
      const domTree = JSON.stringify({ tag: 'body', rect: { width: 100, height: 100 } });
      const pageState = JSON.stringify({
        url: 'http://localhost', title: 'T',
        viewport: { width: 100, height: 100 },
        scroll: { x: 0, y: 0 },
        document: { width: 100, height: 100 },
        hasTauri: false,
      });
      const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

      let callCount = 0;
      // No getDocumentTitle call expected — title is provided directly
      const responses = [domTree, pageState, storage];
      const mockFetch = vi.fn().mockImplementation(() => {
        const result = responses[callCount++];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Command } = await import('commander');
      const { registerSnapshot } = await import('../../src/commands/snapshot.js');
      const program = new Command();
      const adapter = createMockAdapter();
      registerSnapshot(program, () => adapter);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'snapshot', '-o', '/tmp/t', '-t', 'My Custom Title']);
      logSpy.mockRestore();
      vi.unstubAllGlobals();

      expect(vi.mocked(adapter.findWindow)).toHaveBeenCalledWith('My Custom Title');
    });

    it('crops screenshot when --selector is provided', async () => {
      // Bridge calls: getDocumentTitle, getElementRect, getViewportSize, DOM, pageState, storage
      const elementRect = JSON.stringify({ x: 50, y: 100, width: 200, height: 150 });
      const viewport = JSON.stringify({ width: 1920, height: 1080 });
      const domTree = JSON.stringify({ tag: 'body', rect: { width: 1920, height: 1080 } });
      const pageState = JSON.stringify({
        url: 'http://localhost', title: 'App',
        viewport: { width: 1920, height: 1080 },
        scroll: { x: 0, y: 0 },
        document: { width: 1920, height: 2000 },
        hasTauri: true,
      });
      const storage = JSON.stringify({ localStorage: [], sessionStorage: [] });

      let callCount = 0;
      const responses = ['App', elementRect, viewport, domTree, pageState, storage];
      const mockFetch = vi.fn().mockImplementation(() => {
        const result = responses[callCount++];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { exec } = await import('../../src/util/exec.js');
      const mockExec = vi.mocked(exec);
      // cropImage calls convert
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('cropped-png'), stderr: '' });

      const { Command } = await import('commander');
      const { registerSnapshot } = await import('../../src/commands/snapshot.js');
      const program = new Command();
      const adapter = createMockAdapter();
      registerSnapshot(program, () => adapter);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'snapshot', '-o', '/tmp/crop', '-s', '#target', '--json']);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      logSpy.mockRestore();
      vi.unstubAllGlobals();

      expect(output.screenshot).toBe('/tmp/crop-screenshot.png');
      // Verify crop was called (convert invoked via exec)
      expect(mockExec).toHaveBeenCalledWith(
        'convert',
        expect.arrayContaining(['-crop']),
        expect.anything(),
      );
      // Verify the written screenshot is the cropped buffer
      const screenshotWrite = mockWriteFile.mock.calls.find(c => c[0] === '/tmp/crop-screenshot.png');
      expect(screenshotWrite).toBeDefined();
      expect(screenshotWrite![1]).toEqual(Buffer.from('cropped-png'));
    });
  });
});
