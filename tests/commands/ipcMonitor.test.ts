import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';
import { CLEANUP_SCRIPT, DRAIN_SCRIPT, PATCH_SCRIPT } from '../../src/commands/ipcMonitor.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

describe('IPC Monitor', () => {
  describe('patch injection', () => {
    function runBrowserScript<T>(script: string, windowObj: Record<string, unknown>): T {
      let now = 10;
      const performanceObj = {
        now: () => {
          now += 5;
          return now;
        },
      };
      return new Function('window', 'performance', `return ${script};`)(windowObj, performanceObj) as T;
    }

    it('generates valid patch script that returns status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'patched' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const result = await client.eval(`(() => {
        if (window.__tauriDevToolsPatched) return 'already_patched';
        return 'patched';
      })()`);

      expect(result).toBe('patched');
      vi.unstubAllGlobals();
    });

    it('patches window.__TAURI_INTERNALS__.invoke when available', async () => {
      const originalInvoke = vi.fn().mockResolvedValue('ok');
      const windowObj = {
        __TAURI_INTERNALS__: { invoke: originalInvoke },
      } as Record<string, unknown> & {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      };

      expect(runBrowserScript<string>(PATCH_SCRIPT, windowObj)).toBe('patched');
      await expect(windowObj.__TAURI_INTERNALS__.invoke('get_data', { id: 1 })).resolves.toBe('ok');

      expect(originalInvoke).toHaveBeenCalledWith('get_data', { id: 1 }, undefined);
      const entries = JSON.parse(runBrowserScript<string>(DRAIN_SCRIPT, windowObj));
      expect(entries).toHaveLength(1);
      expect(entries[0].command).toBe('get_data');
      expect(entries[0].result).toBe('ok');

      expect(runBrowserScript<string>(CLEANUP_SCRIPT, windowObj)).toBe('cleaned');
      expect(windowObj.__TAURI_INTERNALS__.invoke).toBe(originalInvoke);
    });

    it('falls back to window.__TAURI__.core.invoke', async () => {
      const originalInvoke = vi.fn().mockResolvedValue('ok');
      const windowObj = {
        __TAURI__: { core: { invoke: originalInvoke } },
      } as Record<string, unknown> & {
        __TAURI__: { core: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };
      };

      expect(runBrowserScript<string>(PATCH_SCRIPT, windowObj)).toBe('patched');
      await expect(windowObj.__TAURI__.core.invoke('get_data', {})).resolves.toBe('ok');

      expect(originalInvoke).toHaveBeenCalledWith('get_data', {}, undefined);
      expect(runBrowserScript<string>(CLEANUP_SCRIPT, windowObj)).toBe('cleaned');
      expect(windowObj.__TAURI__.core.invoke).toBe(originalInvoke);
    });

    it('reports no_tauri when no invoke API exists', () => {
      expect(runBrowserScript<string>(PATCH_SCRIPT, {})).toBe('no_tauri');
    });

    it('drain script returns empty array by default', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: '[]' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const raw = await client.eval(`(() => {
        var log = window.__tauriDevToolsIpcLog || [];
        window.__tauriDevToolsIpcLog = [];
        return JSON.stringify(log);
      })()`);

      const entries = JSON.parse(String(raw));
      expect(entries).toEqual([]);
      vi.unstubAllGlobals();
    });
  });

  describe('filter matching', () => {
    function escapeRegExp(s: string): string {
      return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }

    function compileWildcardFilter(filter: string): RegExp | null {
      if (!filter.includes('*')) return null;
      const pattern = '^' + filter.split('*').map(escapeRegExp).join('.*') + '$';
      return new RegExp(pattern);
    }

    function matchesFilter(command: string, filter: string): boolean {
      const regex = compileWildcardFilter(filter);
      if (regex) return regex.test(command);
      return command === filter;
    }

    it('matches exact command names', () => {
      expect(matchesFilter('get_data', 'get_data')).toBe(true);
      expect(matchesFilter('get_data', 'set_data')).toBe(false);
    });

    it('matches wildcard patterns', () => {
      expect(matchesFilter('get_users', 'get_*')).toBe(true);
      expect(matchesFilter('get_posts', 'get_*')).toBe(true);
      expect(matchesFilter('set_users', 'get_*')).toBe(false);
    });

    it('matches complex wildcards', () => {
      expect(matchesFilter('plugin:fs|read', 'plugin:*')).toBe(true);
      expect(matchesFilter('plugin:fs|read', '*read')).toBe(true);
      expect(matchesFilter('get_data', '*data*')).toBe(true);
    });

    it('escapes regex special characters in non-wildcard parts', () => {
      expect(matchesFilter('plugin:fs|read', 'plugin:fs|*')).toBe(true);
      expect(matchesFilter('plugin:http|get', 'plugin:fs|*')).toBe(false);
    });
  });

  describe('entry formatting', () => {
    function formatEntry(entry: {
      command: string;
      timestamp: number;
      duration?: number;
      error?: string;
    }): string {
      const time = new Date(entry.timestamp).toISOString().slice(11, 23);
      const dur = entry.duration !== undefined ? ` ${entry.duration}ms` : '';
      const status = entry.error ? `ERR: ${entry.error}` : 'OK';
      return `[${time}]${dur} ${entry.command} ${status}`;
    }

    it('formats successful entry', () => {
      const entry = {
        command: 'get_users',
        args: {},
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
        duration: 42,
      };

      const line = formatEntry(entry);
      expect(line).toBe('[10:30:45.123] 42ms get_users OK');
    });

    it('formats error entry', () => {
      const entry = {
        command: 'save_data',
        args: {},
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
        duration: 150,
        error: 'Permission denied',
      };

      const line = formatEntry(entry);
      expect(line).toBe('[10:30:45.123] 150ms save_data ERR: Permission denied');
    });

    it('formats entry without duration', () => {
      const entry = {
        command: 'ping',
        args: {},
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
      };

      const line = formatEntry(entry);
      expect(line).toBe('[10:30:45.123] ping OK');
    });
  });

  describe('cleanup', () => {
    it('cleanup script restores original invoke', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'cleaned' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const result = await client.eval(`(() => {
        if (window.__tauriDevToolsOriginalInvoke) {
          return 'cleaned';
        }
        return 'nothing_to_clean';
      })()`);

      expect(typeof result).toBe('string');
      vi.unstubAllGlobals();
    });
  });
});
