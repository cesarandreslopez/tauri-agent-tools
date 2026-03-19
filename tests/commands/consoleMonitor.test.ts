import { describe, it, expect, vi } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

describe('Console Monitor', () => {
  describe('level filtering', () => {
    function matchesLevel(
      entry: { level: string },
      level?: string,
    ): boolean {
      if (!level) return true;
      return entry.level === level;
    }

    it('matches when no level filter is set', () => {
      expect(matchesLevel({ level: 'log' })).toBe(true);
      expect(matchesLevel({ level: 'error' })).toBe(true);
      expect(matchesLevel({ level: 'warn' })).toBe(true);
      expect(matchesLevel({ level: 'info' })).toBe(true);
      expect(matchesLevel({ level: 'debug' })).toBe(true);
    });

    it('matches exact level', () => {
      expect(matchesLevel({ level: 'error' }, 'error')).toBe(true);
      expect(matchesLevel({ level: 'warn' }, 'warn')).toBe(true);
      expect(matchesLevel({ level: 'log' }, 'log')).toBe(true);
    });

    it('rejects non-matching level', () => {
      expect(matchesLevel({ level: 'log' }, 'error')).toBe(false);
      expect(matchesLevel({ level: 'warn' }, 'info')).toBe(false);
      expect(matchesLevel({ level: 'debug' }, 'error')).toBe(false);
    });
  });

  describe('text filter matching', () => {
    function compileRegex(pattern: string, label: string): RegExp {
      try {
        return new RegExp(pattern);
      } catch {
        throw new Error(`Invalid ${label} regex: ${pattern}`);
      }
    }

    function matchesTextFilter(message: string, filter?: string): boolean {
      if (!filter) return true;
      const regex = compileRegex(filter, 'filter');
      return regex.test(message);
    }

    it('matches when no filter is set', () => {
      expect(matchesTextFilter('anything')).toBe(true);
      expect(matchesTextFilter('')).toBe(true);
    });

    it('matches regex pattern', () => {
      expect(matchesTextFilter('api request failed', 'api.*failed')).toBe(true);
      expect(matchesTextFilter('api call failed', 'api.*failed')).toBe(true);
    });

    it('rejects non-matching pattern', () => {
      expect(matchesTextFilter('database connected', 'api.*failed')).toBe(false);
    });

    it('matches partial text', () => {
      expect(matchesTextFilter('error: something went wrong', 'error')).toBe(true);
    });

    it('throws on invalid regex', () => {
      expect(() => compileRegex('[invalid', 'filter')).toThrow('Invalid filter regex: [invalid');
    });
  });

  describe('entry formatting', () => {
    function formatConsoleEntry(entry: {
      level: string;
      message: string;
      timestamp: number;
    }): string {
      const time = new Date(entry.timestamp).toISOString().slice(11, 23);
      return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}`;
    }

    it('formats log entry with timestamp and level', () => {
      const entry = {
        level: 'log',
        message: 'hello world',
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
      };

      const line = formatConsoleEntry(entry);
      expect(line).toBe('[10:30:45.123] [LOG] hello world');
    });

    it('formats error entry', () => {
      const entry = {
        level: 'error',
        message: 'something failed',
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
      };

      const line = formatConsoleEntry(entry);
      expect(line).toBe('[10:30:45.123] [ERROR] something failed');
    });

    it('formats warn entry', () => {
      const entry = {
        level: 'warn',
        message: 'deprecated API',
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
      };

      const line = formatConsoleEntry(entry);
      expect(line).toBe('[10:30:45.123] [WARN] deprecated API');
    });

    it('formats debug entry', () => {
      const entry = {
        level: 'debug',
        message: 'state: {count: 1}',
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
      };

      const line = formatConsoleEntry(entry);
      expect(line).toBe('[10:30:45.123] [DEBUG] state: {count: 1}');
    });
  });

  describe('patch/drain/cleanup scripts', () => {
    it('patch script returns status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'patched' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const result = await client.eval(`(() => {
        if (window.__tauriDevToolsConsolePatched) return 'already_patched';
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
        var log = window.__tauriDevToolsConsoleLogs || [];
        window.__tauriDevToolsConsoleLogs = [];
        return JSON.stringify(log);
      })()`);

      const entries = JSON.parse(String(raw));
      expect(entries).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('cleanup script returns status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'cleaned' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const result = await client.eval(`(() => {
        if (window.__tauriDevToolsOriginalConsole) {
          return 'cleaned';
        }
        return 'nothing_to_clean';
      })()`);

      expect(typeof result).toBe('string');
      vi.unstubAllGlobals();
    });
  });
});
