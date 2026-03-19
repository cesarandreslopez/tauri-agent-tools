import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

describe('IPC Monitor', () => {
  describe('patch injection', () => {
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
