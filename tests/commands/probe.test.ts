import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { BridgeClient } from '../../src/bridge/client.js';
import { DescribeResponseSchema, VersionResponseSchema } from '../../src/schemas/bridge.js';
import { registerProbe } from '../../src/commands/probe.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test-token' }),
  discoverBridgesByPid: vi.fn().mockResolvedValue(new Map([[12345, { port: 9999, token: 'test-token' }]])),
}));

vi.mock('../../src/platform/detect.js', () => ({
  detectDisplayServer: vi.fn().mockReturnValue('darwin'),
}));

// ── Schema tests ──────────────────────────────────────────────────────────────

describe('DescribeResponseSchema', () => {
  it('accepts a fully populated object', () => {
    const data = {
      app: 'my-tauri-app',
      pid: 12345,
      windows: ['main', 'overlay'],
      capabilities: ['eval', 'logs'],
      surfaces: { main: 'webview' },
      exports: { greet: 'function' },
    };
    const result = DescribeResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.app).toBe('my-tauri-app');
      expect(result.data.pid).toBe(12345);
      expect(result.data.windows).toEqual(['main', 'overlay']);
    }
  });

  it('accepts an empty object (all fields optional)', () => {
    const result = DescribeResponseSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.app).toBeUndefined();
      expect(result.data.pid).toBeUndefined();
    }
  });

  it('accepts partial data with only app field', () => {
    const result = DescribeResponseSchema.safeParse({ app: 'my-app' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.app).toBe('my-app');
      expect(result.data.windows).toBeUndefined();
    }
  });

  it('accepts partial data with only windows and capabilities', () => {
    const result = DescribeResponseSchema.safeParse({
      windows: ['main'],
      capabilities: ['eval'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid pid type', () => {
    const result = DescribeResponseSchema.safeParse({ pid: 'not-a-number' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid windows type (non-array)', () => {
    const result = DescribeResponseSchema.safeParse({ windows: 'main' });
    expect(result.success).toBe(false);
  });
});

describe('VersionResponseSchema', () => {
  it('accepts a valid version response', () => {
    const data = {
      version: '1.2.3',
      endpoints: ['/eval', '/logs', '/describe', '/version'],
    };
    const result = VersionResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1.2.3');
      expect(result.data.endpoints).toHaveLength(4);
    }
  });

  it('accepts an empty endpoints array', () => {
    const result = VersionResponseSchema.safeParse({ version: '0.1.0', endpoints: [] });
    expect(result.success).toBe(true);
  });

  it('rejects missing version field', () => {
    const result = VersionResponseSchema.safeParse({ endpoints: ['/eval'] });
    expect(result.success).toBe(false);
  });

  it('rejects missing endpoints field', () => {
    const result = VersionResponseSchema.safeParse({ version: '1.0.0' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string version', () => {
    const result = VersionResponseSchema.safeParse({ version: 123, endpoints: [] });
    expect(result.success).toBe(false);
  });

  it('rejects non-array endpoints', () => {
    const result = VersionResponseSchema.safeParse({ version: '1.0.0', endpoints: '/eval' });
    expect(result.success).toBe(false);
  });
});

// ── BridgeClient.describe() tests ─────────────────────────────────────────────

describe('BridgeClient.describe()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed DescribeResponse on success', async () => {
    const mockData = {
      app: 'my-app',
      pid: 42,
      windows: ['main'],
      capabilities: ['eval'],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.describe();

    expect(result).not.toBeNull();
    expect(result?.app).toBe('my-app');
    expect(result?.pid).toBe(42);
    expect(result?.windows).toEqual(['main']);
  });

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.describe();
    expect(result).toBeNull();
  });

  it('returns null on any non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.describe();
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.describe();
    expect(result).toBeNull();
  });

  it('sends POST with token to /describe', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'my-secret' });
    await client.describe();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/describe',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'my-secret' }),
      }),
    );
  });

  it('returns null on schema parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pid: 'not-a-number' }),
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.describe();
    expect(result).toBeNull();
  });
});

// ── BridgeClient.version() tests ──────────────────────────────────────────────

describe('BridgeClient.version()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed VersionResponse on success', async () => {
    const mockData = { version: '2.0.0', endpoints: ['/eval', '/version'] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.version();

    expect(result).not.toBeNull();
    expect(result?.version).toBe('2.0.0');
    expect(result?.endpoints).toEqual(['/eval', '/version']);
  });

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.version();
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.version();
    expect(result).toBeNull();
  });

  it('sends GET request to /version without auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0', endpoints: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'my-secret' });
    await client.version();

    // GET /version — only URL and signal, no body/method override
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/version',
      expect.objectContaining({}),
    );
    // Should NOT be a POST
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].method).toBeUndefined();
    expect(callArgs[1].body).toBeUndefined();
  });

  it('returns null on schema parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      // Missing required 'endpoints' field
      json: () => Promise.resolve({ version: '1.0.0' }),
    }));

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.version();
    expect(result).toBeNull();
  });
});

// ── Probe command integration tests ───────────────────────────────────────────

describe('probe command', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerProbe(program);
    return program;
  }

  beforeEach(async () => {
    // Reset mocks but restore discoverBridgesByPid default return value
    const tokenDiscovery = await import('../../src/bridge/tokenDiscovery.js');
    vi.mocked(tokenDiscovery.discoverBridgesByPid).mockResolvedValue(
      new Map([[12345, { port: 9999, token: 'test-token' }]]),
    );
    vi.mocked(tokenDiscovery.discoverBridge).mockResolvedValue({ port: 9999, token: 'test-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('outputs JSON when --json flag is passed', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/eval')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: 'http://localhost:1420/' }),
        });
      }
      if (url.endsWith('/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0', endpoints: ['/eval'] }),
        });
      }
      if (url.endsWith('/describe')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ app: 'my-app', pid: 12345 }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', 'probe',
      '--json',
      '--port', '9999',
      '--token', 'test-token',
    ]);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as {
      bridges: unknown[];
      target: { alive: boolean; version: unknown; describe: unknown; page: unknown };
      platform: string;
    };

    expect(parsed.platform).toBe('darwin');
    expect(parsed.bridges).toBeInstanceOf(Array);
    expect(parsed.target).toBeDefined();
    expect(parsed.target.alive).toBe(true);
  });

  it('outputs human-readable text without --json', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/eval')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: 'http://localhost:1420/' }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', 'probe',
      '--port', '9999',
      '--token', 'test-token',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('=== Tauri Bridge Probe ===');
    expect(output).toContain('Platform:');
    expect(output).toContain('Bridge alive:');
    expect(output).toContain('Page:');
  });

  it('shows "none" when no bridges are running', async () => {
    const { discoverBridgesByPid } = await import('../../src/bridge/tokenDiscovery.js');
    vi.mocked(discoverBridgesByPid).mockResolvedValueOnce(new Map());

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: null }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', 'probe',
      '--port', '9999',
      '--token', 'test-token',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('Running bridges:  none');
  });

  it('includes bridge version info in human-readable output when available', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '3.1.0', endpoints: ['/eval', '/version'] }),
        });
      }
      if (url.endsWith('/eval')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: null }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', 'probe',
      '--port', '9999',
      '--token', 'test-token',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('Bridge version:   3.1.0');
    expect(output).toContain('/eval, /version');
  });
});
