import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { BridgeClient } from '../../src/bridge/client.js';
import { registerEval } from '../../src/commands/eval.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test-token' }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

describe('Eval command logic', () => {
  it('BridgeClient.eval sends expression and returns result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'Hello World' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.eval('document.title');

    expect(result).toBe('Hello World');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/eval',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ js: 'document.title', token: 'test-token' }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('eval handles JSON string result with pretty printing', () => {
    const jsonStr = '{"key":"value","nested":{"a":1}}';
    const parsed = JSON.parse(jsonStr);
    const pretty = JSON.stringify(parsed, null, 2);

    expect(pretty).toContain('\n');
    expect(pretty).toContain('  "key"');
  });

  it('handles bridge error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    await expect(client.eval('bad()')).rejects.toThrow('Bridge error (500): Internal Server Error');

    vi.unstubAllGlobals();
  });

  it('handles authentication failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'wrong-token' });
    await expect(client.eval('1')).rejects.toThrow('Bridge authentication failed');

    vi.unstubAllGlobals();
  });

  it('handles 403 as authentication failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'expired-token' });
    await expect(client.eval('1')).rejects.toThrow('Bridge authentication failed');

    vi.unstubAllGlobals();
  });

  it('returns non-string results directly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 42 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.eval('1 + 1');

    expect(result).toBe(42);

    vi.unstubAllGlobals();
  });

  it('returns null result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: null }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.eval('void 0');

    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it('handles multi-line expressions', async () => {
    const multiLineExpr = `
      const items = document.querySelectorAll('.item');
      items.length;
    `;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 5 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.eval(multiLineExpr);

    expect(result).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/eval',
      expect.objectContaining({
        body: JSON.stringify({ js: multiLineExpr, token: 'test-token' }),
      }),
    );

    vi.unstubAllGlobals();
  });
});

describe('Eval --file option', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerEval(program);
    return program;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads JavaScript from a file when --file is provided', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);
    mockReadFile.mockResolvedValue('document.title');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'My App' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'eval', '--file', 'script.js', '--port', '9999', '--token', 'test-token']);

    expect(mockReadFile).toHaveBeenCalledWith('script.js', 'utf-8');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/eval',
      expect.objectContaining({
        body: JSON.stringify({ js: 'document.title', token: 'test-token' }),
      }),
    );
    expect(consoleSpy).toHaveBeenCalledWith('My App');

    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('uses expression argument when --file is not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'eval', 'document.title', '--port', '9999', '--token', 'test-token']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/eval',
      expect.objectContaining({
        body: JSON.stringify({ js: 'document.title', token: 'test-token' }),
      }),
    );

    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('throws when neither expression nor --file is provided', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['node', 'test', 'eval', '--port', '9999', '--token', 'test-token']),
    ).rejects.toThrow('Provide either an <expression> argument or --file <path>');
  });

  it('prefers --file over expression argument when both given', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);
    mockReadFile.mockResolvedValue('file-content()');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'from-file' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'eval', 'arg-expr', '--file', 'script.js', '--port', '9999', '--token', 'test-token']);

    expect(mockReadFile).toHaveBeenCalledWith('script.js', 'utf-8');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/eval',
      expect.objectContaining({
        body: JSON.stringify({ js: 'file-content()', token: 'test-token' }),
      }),
    );

    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
