import { describe, it, expect, vi } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';
import { PAGE_STATE_SCRIPT } from '../../src/commands/pageState.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

describe('Page State', () => {
  describe('output formatting', () => {
    function formatPageState(state: {
      url: string;
      title: string;
      viewport: { width: number; height: number };
      scroll: { x: number; y: number };
      document: { width: number; height: number };
      hasTauri: boolean;
    }): string {
      const lines = [
        `URL:             ${state.url}`,
        `Title:           ${state.title}`,
        `Viewport:        ${state.viewport.width}x${state.viewport.height}`,
        `Scroll Position: ${state.scroll.x}, ${state.scroll.y}`,
        `Document Size:   ${state.document.width}x${state.document.height}`,
        `Tauri:           ${state.hasTauri ? 'yes' : 'no'}`,
      ];
      return lines.join('\n');
    }

    it('formats page state with all fields', () => {
      const state = {
        url: 'https://localhost:1420/',
        title: 'My Tauri App',
        viewport: { width: 1920, height: 1080 },
        scroll: { x: 0, y: 250 },
        document: { width: 1920, height: 3500 },
        hasTauri: true,
      };

      const output = formatPageState(state);
      expect(output).toContain('URL:             https://localhost:1420/');
      expect(output).toContain('Title:           My Tauri App');
      expect(output).toContain('Viewport:        1920x1080');
      expect(output).toContain('Scroll Position: 0, 250');
      expect(output).toContain('Document Size:   1920x3500');
      expect(output).toContain('Tauri:           yes');
    });

    it('shows "no" when Tauri is not detected', () => {
      const state = {
        url: 'http://localhost:3000/',
        title: 'Test',
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0 },
        document: { width: 800, height: 600 },
        hasTauri: false,
      };

      const output = formatPageState(state);
      expect(output).toContain('Tauri:           no');
    });

    it('formats viewport and document size as WxH', () => {
      const state = {
        url: 'about:blank',
        title: '',
        viewport: { width: 1024, height: 768 },
        scroll: { x: 100, y: 200 },
        document: { width: 2048, height: 5000 },
        hasTauri: false,
      };

      const output = formatPageState(state);
      expect(output).toContain('1024x768');
      expect(output).toContain('2048x5000');
      expect(output).toContain('100, 200');
    });
  });

  describe('bridge eval', () => {
    function runPageStateScript(windowObj: Record<string, unknown>): {
      hasTauri: boolean;
    } {
      const documentObj = {
        title: 'Test App',
        documentElement: {
          scrollWidth: 800,
          scrollHeight: 600,
        },
      };
      const raw = new Function('window', 'document', `return ${PAGE_STATE_SCRIPT};`)(
        {
          location: { href: 'http://localhost:1420/' },
          innerWidth: 800,
          innerHeight: 600,
          scrollX: 0,
          scrollY: 0,
          ...windowObj,
        },
        documentObj,
      ) as string;
      return JSON.parse(raw);
    }

    it('detects Tauri from __TAURI_INTERNALS__ when global API is disabled', () => {
      expect(runPageStateScript({ __TAURI_INTERNALS__: { invoke: vi.fn() } }).hasTauri).toBe(true);
    });

    it('still detects Tauri from the legacy global API', () => {
      expect(runPageStateScript({ __TAURI__: { core: { invoke: vi.fn() } } }).hasTauri).toBe(true);
    });

    it('parses page state from bridge response', async () => {
      const pageState = {
        url: 'https://localhost:1420/',
        title: 'Test App',
        viewport: { width: 1920, height: 1080 },
        scroll: { x: 0, y: 0 },
        document: { width: 1920, height: 1080 },
        hasTauri: true,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: JSON.stringify(pageState) }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const raw = await client.eval('test');
      const parsed = JSON.parse(String(raw));

      expect(parsed.url).toBe('https://localhost:1420/');
      expect(parsed.title).toBe('Test App');
      expect(parsed.viewport).toEqual({ width: 1920, height: 1080 });
      expect(parsed.hasTauri).toBe(true);
      vi.unstubAllGlobals();
    });
  });
});
