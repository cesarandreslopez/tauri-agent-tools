import { describe, it, expect, vi } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

interface RustLogEntry {
  timestamp: number;
  level: string;
  target: string;
  message: string;
  source: string;
}

const LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error'];

describe('Rust Logs', () => {
  describe('level filtering (severity-based)', () => {
    function matchesLevel(entry: RustLogEntry, level?: string): boolean {
      if (!level) return true;
      const threshold = LEVEL_ORDER.indexOf(level);
      if (threshold === -1) return true;
      const entryLevel = LEVEL_ORDER.indexOf(entry.level);
      return entryLevel >= threshold;
    }

    const makeEntry = (level: string): RustLogEntry => ({
      timestamp: Date.now(),
      level,
      target: 'myapp',
      message: 'test',
      source: 'rust',
    });

    it('matches all entries when no level filter is set', () => {
      for (const level of LEVEL_ORDER) {
        expect(matchesLevel(makeEntry(level))).toBe(true);
      }
    });

    it('trace shows all levels', () => {
      for (const level of LEVEL_ORDER) {
        expect(matchesLevel(makeEntry(level), 'trace')).toBe(true);
      }
    });

    it('warn filters out trace, debug, info', () => {
      expect(matchesLevel(makeEntry('trace'), 'warn')).toBe(false);
      expect(matchesLevel(makeEntry('debug'), 'warn')).toBe(false);
      expect(matchesLevel(makeEntry('info'), 'warn')).toBe(false);
      expect(matchesLevel(makeEntry('warn'), 'warn')).toBe(true);
      expect(matchesLevel(makeEntry('error'), 'warn')).toBe(true);
    });

    it('error only shows error', () => {
      expect(matchesLevel(makeEntry('trace'), 'error')).toBe(false);
      expect(matchesLevel(makeEntry('debug'), 'error')).toBe(false);
      expect(matchesLevel(makeEntry('info'), 'error')).toBe(false);
      expect(matchesLevel(makeEntry('warn'), 'error')).toBe(false);
      expect(matchesLevel(makeEntry('error'), 'error')).toBe(true);
    });

    it('info shows info, warn, error', () => {
      expect(matchesLevel(makeEntry('trace'), 'info')).toBe(false);
      expect(matchesLevel(makeEntry('debug'), 'info')).toBe(false);
      expect(matchesLevel(makeEntry('info'), 'info')).toBe(true);
      expect(matchesLevel(makeEntry('warn'), 'info')).toBe(true);
      expect(matchesLevel(makeEntry('error'), 'info')).toBe(true);
    });
  });

  describe('target filtering', () => {
    function compileRegex(pattern: string, label: string): RegExp {
      try {
        return new RegExp(pattern);
      } catch {
        throw new Error(`Invalid ${label} regex: ${pattern}`);
      }
    }

    function matchesTarget(entry: RustLogEntry, targetRegex?: RegExp): boolean {
      if (!targetRegex) return true;
      return targetRegex.test(entry.target);
    }

    const makeEntry = (target: string): RustLogEntry => ({
      timestamp: Date.now(),
      level: 'info',
      target,
      message: 'test',
      source: 'rust',
    });

    it('matches when no target filter is set', () => {
      expect(matchesTarget(makeEntry('myapp::db'))).toBe(true);
    });

    it('matches exact module path', () => {
      expect(matchesTarget(makeEntry('myapp::db'), compileRegex('myapp::db', 'target'))).toBe(true);
    });

    it('matches regex pattern against module path', () => {
      expect(matchesTarget(makeEntry('myapp::db::pool'), compileRegex('myapp::db', 'target'))).toBe(true);
      expect(matchesTarget(makeEntry('myapp::api::handler'), compileRegex('api', 'target'))).toBe(true);
    });

    it('rejects non-matching module path', () => {
      expect(matchesTarget(makeEntry('myapp::db'), compileRegex('api', 'target'))).toBe(false);
    });

    it('throws on invalid regex', () => {
      expect(() => compileRegex('[invalid', 'target')).toThrow('Invalid target regex: [invalid');
    });
  });

  describe('source filtering', () => {
    function matchesSource(entry: RustLogEntry, source?: string): boolean {
      if (!source || source === 'all') return true;
      if (source === 'rust') return entry.source === 'rust';
      if (source === 'sidecar') return entry.source.startsWith('sidecar:');
      return entry.source === source;
    }

    const makeEntry = (source: string): RustLogEntry => ({
      timestamp: Date.now(),
      level: 'info',
      target: 'myapp',
      message: 'test',
      source,
    });

    it('matches all when source is "all"', () => {
      expect(matchesSource(makeEntry('rust'), 'all')).toBe(true);
      expect(matchesSource(makeEntry('sidecar:ffmpeg'), 'all')).toBe(true);
    });

    it('matches all when no source filter is set', () => {
      expect(matchesSource(makeEntry('rust'))).toBe(true);
      expect(matchesSource(makeEntry('sidecar:ffmpeg'))).toBe(true);
    });

    it('filters to rust-only', () => {
      expect(matchesSource(makeEntry('rust'), 'rust')).toBe(true);
      expect(matchesSource(makeEntry('sidecar:ffmpeg'), 'rust')).toBe(false);
    });

    it('filters to any sidecar', () => {
      expect(matchesSource(makeEntry('sidecar:ffmpeg'), 'sidecar')).toBe(true);
      expect(matchesSource(makeEntry('sidecar:python'), 'sidecar')).toBe(true);
      expect(matchesSource(makeEntry('rust'), 'sidecar')).toBe(false);
    });

    it('filters to specific sidecar', () => {
      expect(matchesSource(makeEntry('sidecar:ffmpeg'), 'sidecar:ffmpeg')).toBe(true);
      expect(matchesSource(makeEntry('sidecar:python'), 'sidecar:ffmpeg')).toBe(false);
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

    function matchesTextFilter(message: string, filterRegex?: RegExp): boolean {
      if (!filterRegex) return true;
      return filterRegex.test(message);
    }

    it('matches when no filter is set', () => {
      expect(matchesTextFilter('anything')).toBe(true);
    });

    it('matches regex pattern', () => {
      expect(matchesTextFilter('database connection failed', compileRegex('connection.*failed', 'filter'))).toBe(true);
    });

    it('rejects non-matching pattern', () => {
      expect(matchesTextFilter('database connected', compileRegex('connection.*failed', 'filter'))).toBe(false);
    });

    it('throws on invalid regex', () => {
      expect(() => compileRegex('[invalid', 'filter')).toThrow('Invalid filter regex: [invalid');
    });
  });

  describe('entry formatting', () => {
    function formatLogEntry(entry: RustLogEntry): string {
      const time = new Date(entry.timestamp).toISOString().slice(11, 23);
      const level = entry.level.toUpperCase();
      if (entry.source !== 'rust') {
        return `[${time}] [${level}] [${entry.source}] ${entry.target}: ${entry.message}`;
      }
      return `[${time}] [${level}] ${entry.target}: ${entry.message}`;
    }

    it('formats rust log entry without source tag', () => {
      const entry: RustLogEntry = {
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
        level: 'info',
        target: 'myapp::db',
        message: 'Connected to database',
        source: 'rust',
      };

      expect(formatLogEntry(entry)).toBe(
        '[10:30:45.123] [INFO] myapp::db: Connected to database',
      );
    });

    it('formats sidecar entry with source tag', () => {
      const entry: RustLogEntry = {
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
        level: 'warn',
        target: 'stderr',
        message: 'deprecated flag used',
        source: 'sidecar:ffmpeg',
      };

      expect(formatLogEntry(entry)).toBe(
        '[10:30:45.123] [WARN] [sidecar:ffmpeg] stderr: deprecated flag used',
      );
    });

    it('formats error level entry', () => {
      const entry: RustLogEntry = {
        timestamp: new Date('2024-01-15T10:30:45.123Z').getTime(),
        level: 'error',
        target: 'myapp::api',
        message: 'Request failed',
        source: 'rust',
      };

      expect(formatLogEntry(entry)).toBe(
        '[10:30:45.123] [ERROR] myapp::api: Request failed',
      );
    });
  });

  describe('fetchLogs via bridge', () => {
    it('fetches log entries from /logs endpoint', async () => {
      const entries: RustLogEntry[] = [
        { timestamp: 1000, level: 'info', target: 'myapp', message: 'hello', source: 'rust' },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      const result = await client.fetchLogs();

      expect(result).toEqual(entries);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9999/logs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'test' }),
        }),
      );
      vi.unstubAllGlobals();
    });

    it('throws clear error on 404 (old bridge)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'test' });
      await expect(client.fetchLogs()).rejects.toThrow(
        'Bridge does not support /logs',
      );
      vi.unstubAllGlobals();
    });

    it('throws on authentication failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BridgeClient({ port: 9999, token: 'bad' });
      await expect(client.fetchLogs()).rejects.toThrow(
        'Bridge authentication failed',
      );
      vi.unstubAllGlobals();
    });
  });
});
