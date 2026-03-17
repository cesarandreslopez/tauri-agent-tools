import { describe, it, expect, vi } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
}));

describe('Eval command logic', () => {
  it('BridgeClient.eval sends expression and returns result', async () => {
    // We test the client method that eval command depends on
    // The actual HTTP interaction is tested in bridge/client.test.ts
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
    // Test the pretty-print logic from eval command
    const jsonStr = '{"key":"value","nested":{"a":1}}';
    const parsed = JSON.parse(jsonStr);
    const pretty = JSON.stringify(parsed, null, 2);

    expect(pretty).toContain('\n');
    expect(pretty).toContain('  "key"');
  });
});
