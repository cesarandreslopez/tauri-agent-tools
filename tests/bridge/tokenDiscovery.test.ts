import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PRIMARY_DIR = '/mock/os-tmp';
const FALLBACK_DIR = '/tmp';

const fsMock = vi.hoisted(() => ({
  dirs: new Set<string>(),
  files: new Map<string, string>(),
  mtimes: new Map<string, number>(),
}));

const osMock = vi.hoisted(() => ({
  tmpDir: '/mock/os-tmp',
}));

vi.mock('node:os', () => ({
  tmpdir: () => osMock.tmpDir,
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(async (dirLike: string) => {
    const dir = String(dirLike);
    if (!fsMock.dirs.has(dir)) {
      throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' });
    }

    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    return Array.from(fsMock.files.keys())
      .filter((filePath) => filePath.startsWith(prefix))
      .map((filePath) => filePath.slice(prefix.length))
      .filter((fileName) => fileName.length > 0 && !fileName.includes('/'));
  }),
  readFile: vi.fn(async (fileLike: string) => {
    const filePath = String(fileLike);
    const content = fsMock.files.get(filePath);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
    }
    return content;
  }),
  stat: vi.fn(async (fileLike: string) => {
    const filePath = String(fileLike);
    if (!fsMock.files.has(filePath)) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
    }
    return { mtimeMs: fsMock.mtimes.get(filePath) ?? 0 };
  }),
  unlink: vi.fn(async (fileLike: string) => {
    const filePath = String(fileLike);
    fsMock.mtimes.delete(filePath);
    if (!fsMock.files.delete(filePath)) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
    }
  }),
}));

const { discoverBridge, discoverBridgesByPid } = await import(
  '../../src/bridge/tokenDiscovery.js'
);

describe('tokenDiscovery', () => {
  const mockedReaddir = vi.mocked(readdir);

  beforeEach(() => {
    vi.clearAllMocks();
    osMock.tmpDir = PRIMARY_DIR;
    fsMock.dirs.clear();
    fsMock.files.clear();
    fsMock.mtimes.clear();
    fsMock.dirs.add(PRIMARY_DIR);
    fsMock.dirs.add(FALLBACK_DIR);
  });

  type TokenData = { port: number; token: string; pid: number };

  function writeTokenFile(
    dir: string,
    pid: number,
    data: TokenData,
    mtimeMs = 1,
  ): void {
    writeRawFile(dir, `tauri-dev-bridge-${pid}.token`, JSON.stringify(data), mtimeMs);
  }

  function writeRawFile(dir: string, fileName: string, content: string, mtimeMs = 1): void {
    const filePath = join(dir, fileName);
    fsMock.files.set(filePath, content);
    fsMock.mtimes.set(filePath, mtimeMs);
  }

  function listTokenFiles(dir: string): string[] {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    return Array.from(fsMock.files.keys())
      .filter((filePath) => filePath.startsWith(prefix))
      .map((filePath) => filePath.slice(prefix.length))
      .filter((fileName) => fileName.startsWith('tauri-dev-bridge-'));
  }

  describe('discoverBridge', () => {
    it('returns config from a valid token file in os.tmpdir()', async () => {
      writeTokenFile(PRIMARY_DIR, process.pid, {
        port: 8080,
        token: 'abc123',
        pid: process.pid,
      });

      const config = await discoverBridge();
      expect(config).toEqual({ port: 8080, token: 'abc123' });
    });

    it('returns config from /tmp when os.tmpdir() has no token files', async () => {
      writeTokenFile(FALLBACK_DIR, process.pid, {
        port: 63529,
        token: 'fallback-token',
        pid: process.pid,
      });

      const config = await discoverBridge();
      expect(config).toEqual({ port: 63529, token: 'fallback-token' });
    });

    it('continues to /tmp when os.tmpdir() cannot be read', async () => {
      fsMock.dirs.delete(PRIMARY_DIR);
      writeTokenFile(FALLBACK_DIR, process.pid, {
        port: 63529,
        token: 'fallback-token',
        pid: process.pid,
      });

      const config = await discoverBridge();
      expect(config).toEqual({ port: 63529, token: 'fallback-token' });
    });

    it('prefers os.tmpdir() over /tmp when both contain live bridges', async () => {
      writeTokenFile(FALLBACK_DIR, process.pid, {
        port: 2222,
        token: 'fallback',
        pid: process.pid,
      });
      writeTokenFile(PRIMARY_DIR, process.pid, {
        port: 1111,
        token: 'primary',
        pid: process.pid,
      });

      const config = await discoverBridge();
      expect(config).toEqual({ port: 1111, token: 'primary' });
    });

    it('returns null when no token files exist', async () => {
      const config = await discoverBridge();
      expect(config).toBeNull();
    });

    it('cleans up stale token files from dead processes', async () => {
      writeTokenFile(FALLBACK_DIR, 999999, {
        port: 8080,
        token: 'stale',
        pid: 999999,
      });

      const config = await discoverBridge();
      expect(config).toBeNull();

      expect(listTokenFiles(FALLBACK_DIR)).toHaveLength(0);
    });

    it('skips malformed JSON files', async () => {
      writeRawFile(PRIMARY_DIR, 'tauri-dev-bridge-12345.token', 'not valid json{{{');

      writeTokenFile(PRIMARY_DIR, process.pid, {
        port: 9090,
        token: 'valid',
        pid: process.pid,
      });

      const config = await discoverBridge();
      expect(config).toEqual({ port: 9090, token: 'valid' });
    });

    it('skips files missing required fields', async () => {
      writeRawFile(
        PRIMARY_DIR,
        'tauri-dev-bridge-77777.token',
        JSON.stringify({ port: 8080 }),
      );

      const config = await discoverBridge();
      expect(config).toBeNull();
    });

    it('returns the first live bridge when multiple exist', async () => {
      writeTokenFile(PRIMARY_DIR, process.pid, {
        port: 1111,
        token: 'first',
        pid: process.pid,
      });

      writeRawFile(
        PRIMARY_DIR,
        `tauri-dev-bridge-${process.pid + 100000}.token`,
        JSON.stringify({ port: 2222, token: 'second', pid: process.pid }),
      );

      const config = await discoverBridge();
      expect(config).not.toBeNull();
      expect([1111, 2222]).toContain(config!.port);
    });

    it('returns the newest live bridge within os.tmpdir()', async () => {
      writeTokenFile(
        PRIMARY_DIR,
        process.pid,
        {
          port: 1111,
          token: 'older',
          pid: process.pid,
        },
        100,
      );
      writeRawFile(
        PRIMARY_DIR,
        `tauri-dev-bridge-${process.pid + 100000}.token`,
        JSON.stringify({ port: 2222, token: 'newer', pid: process.pid }),
        200,
      );

      const config = await discoverBridge();
      expect(config).toEqual({ port: 2222, token: 'newer' });
    });

    it('uses filename as a deterministic tie-break for equal mtimes', async () => {
      writeRawFile(
        PRIMARY_DIR,
        'tauri-dev-bridge-100.token',
        JSON.stringify({ port: 1000, token: 'lower-name', pid: process.pid }),
        100,
      );
      writeRawFile(
        PRIMARY_DIR,
        'tauri-dev-bridge-200.token',
        JSON.stringify({ port: 2000, token: 'higher-name', pid: process.pid }),
        100,
      );

      const config = await discoverBridge();
      expect(config).toEqual({ port: 2000, token: 'higher-name' });
    });

    it('excludes stale dead-pid tokens before choosing the newest bridge', async () => {
      writeTokenFile(
        PRIMARY_DIR,
        999999,
        {
          port: 9999,
          token: 'stale-newest',
          pid: 999999,
        },
        300,
      );
      writeTokenFile(
        PRIMARY_DIR,
        process.pid,
        {
          port: 1111,
          token: 'live-older',
          pid: process.pid,
        },
        100,
      );

      const config = await discoverBridge();
      expect(config).toEqual({ port: 1111, token: 'live-older' });
      expect(listTokenFiles(PRIMARY_DIR)).toEqual([`tauri-dev-bridge-${process.pid}.token`]);
    });

    it('keeps os.tmpdir priority even when /tmp has a newer live bridge', async () => {
      writeTokenFile(
        FALLBACK_DIR,
        process.pid,
        {
          port: 2222,
          token: 'fallback-newer',
          pid: process.pid,
        },
        200,
      );
      writeTokenFile(
        PRIMARY_DIR,
        process.pid,
        {
          port: 1111,
          token: 'primary-older',
          pid: process.pid,
        },
        100,
      );

      const config = await discoverBridge();
      expect(config).toEqual({ port: 1111, token: 'primary-older' });
    });

    it('does not scan /tmp twice when os.tmpdir() is also /tmp', async () => {
      osMock.tmpDir = FALLBACK_DIR;
      writeTokenFile(FALLBACK_DIR, process.pid, {
        port: 8080,
        token: 'abc123',
        pid: process.pid,
      });

      const config = await discoverBridge();
      expect(config).toEqual({ port: 8080, token: 'abc123' });
      expect(mockedReaddir).toHaveBeenCalledTimes(1);
      expect(mockedReaddir).toHaveBeenCalledWith(FALLBACK_DIR);
    });
  });

  describe('discoverBridgesByPid', () => {
    it('returns a map of PID to config for live bridges across both dirs', async () => {
      writeTokenFile(PRIMARY_DIR, process.pid, {
        port: 8080,
        token: 'abc123',
        pid: process.pid,
      });
      writeTokenFile(FALLBACK_DIR, process.ppid, {
        port: 9090,
        token: 'parent-token',
        pid: process.ppid,
      });

      const result = await discoverBridgesByPid();
      expect(result).toBeInstanceOf(Map);
      expect(result.get(process.pid)).toEqual({ port: 8080, token: 'abc123' });
      expect(result.get(process.ppid)).toEqual({
        port: 9090,
        token: 'parent-token',
      });
    });

    it('returns empty map when no token files exist', async () => {
      const result = await discoverBridgesByPid();
      expect(result.size).toBe(0);
    });

    it('excludes stale PIDs', async () => {
      writeTokenFile(FALLBACK_DIR, 999999, {
        port: 8080,
        token: 'stale',
        pid: 999999,
      });

      const result = await discoverBridgesByPid();
      expect(result.size).toBe(0);
    });
  });
});
