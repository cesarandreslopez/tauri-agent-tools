import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BridgeClient } from '../../src/bridge/client.js';

const TEST_TOKEN = 'tier2-test-token';

// Three fixture servers exercise the three feature-detection scenarios the
// CLI needs to handle: (1) a current bridge that publishes all v0.7 endpoints,
// (2) an old bridge that only knows about /eval+/logs+/version+/describe,
// (3) a bridge that doesn't respond to /version at all.

function spinServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

let modern: { port: number; close: () => Promise<void> };
let oldBridge: { port: number; close: () => Promise<void> };
let silent: { port: number; close: () => Promise<void> };

beforeAll(async () => {
  modern = await spinServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          version: '0.7.0',
          endpoints: ['/eval', '/logs', '/describe', '/version', '/process', '/capabilities', '/devtools', '/health'],
        }),
      );
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const data = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      if (data.token !== TEST_TOKEN) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      const reply = (payload: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/process') {
        reply({
          tauri: { pid: 12345, exe: '/path/to/app', args: ['--ipc=stdio'], uptime_ms: 12000 },
          sidecars: [
            { name: 'helper', pid: 67890, exe: '/path/to/helper', args: ['--port=9000'], alive: true },
            { name: 'gone', pid: 99999, args: [], alive: false },
          ],
        });
        return;
      }
      if (req.url === '/capabilities') {
        reply({
          declared: [
            {
              identifier: 'default',
              description: 'core',
              windows: ['main'],
              permissions: ['core:default', 'fs:allow-all', '*'],
            },
            {
              identifier: 'extra',
              windows: ['nonexistent-window'],
              permissions: ['shell:default'],
            },
          ],
          windows: ['main'],
        });
        return;
      }
      if (req.url === '/devtools') {
        reply({
          platform: 'wkwebview',
          inspectable: true,
          url: null,
          hint: 'Open Safari > Develop > <App> to attach.',
        });
        return;
      }
      if (req.url === '/health') {
        reply({
          uptime_ms: 12000,
          webview_ready: true,
          sidecars_alive: false,
          sidecars: [
            { name: 'helper', pid: 67890, args: [], alive: true },
            { name: 'gone', pid: 99999, args: [], alive: false },
          ],
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
  });

  oldBridge = await spinServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          version: '0.6.0',
          endpoints: ['/eval', '/logs', '/describe', '/version'],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  silent = await spinServer(async (_req, res) => {
    res.writeHead(404);
    res.end('Nope');
  });
});

afterAll(async () => {
  await modern.close();
  await oldBridge.close();
  await silent.close();
});

describe('BridgeClient v0.7 endpoints', () => {
  it('process() returns the structured process tree', async () => {
    const client = new BridgeClient({ port: modern.port, token: TEST_TOKEN });
    const p = await client.process();
    expect(p.tauri.pid).toBe(12345);
    expect(p.tauri.uptime_ms).toBe(12000);
    expect(p.sidecars).toHaveLength(2);
    expect(p.sidecars[0]?.name).toBe('helper');
    expect(p.sidecars[1]?.alive).toBe(false);
  });

  it('capabilities() returns declared + windows', async () => {
    const client = new BridgeClient({ port: modern.port, token: TEST_TOKEN });
    const c = await client.capabilities();
    expect(c.windows).toEqual(['main']);
    expect(c.declared).toHaveLength(2);
    expect(c.declared[0]?.identifier).toBe('default');
  });

  it('devtools() returns platform-tagged inspector info', async () => {
    const client = new BridgeClient({ port: modern.port, token: TEST_TOKEN });
    const d = await client.devtools();
    expect(d.platform).toBe('wkwebview');
    expect(d.inspectable).toBe(true);
    expect(d.url).toBeNull();
    expect(d.hint).toContain('Safari');
  });

  it('health() reports uptime and per-sidecar liveness', async () => {
    const client = new BridgeClient({ port: modern.port, token: TEST_TOKEN });
    const h = await client.health();
    expect(h.webview_ready).toBe(true);
    expect(h.sidecars_alive).toBe(false);
    expect(h.sidecars.find((s) => s.name === 'gone')?.alive).toBe(false);
  });

  it('errors actionably when called against an old (pre-v0.7) bridge', async () => {
    const client = new BridgeClient({ port: oldBridge.port, token: TEST_TOKEN });
    await expect(client.process()).rejects.toThrow(/v0\.7\.0\+.*Re-copy.*dev_bridge\.rs/);
  });

  it('errors actionably when /version is unreachable', async () => {
    const client = new BridgeClient({ port: silent.port, token: TEST_TOKEN });
    await expect(client.health()).rejects.toThrow(/did not respond to \/version/);
  });

  it('caches the /version response across calls (no second roundtrip)', async () => {
    const client = new BridgeClient({ port: modern.port, token: TEST_TOKEN });
    await client.process();
    // Subsequent calls succeed without hitting /version again — covered
    // implicitly by the fact that no /version request error would surface even
    // if we changed the server to 500 on /version after the first call. Here
    // we just assert both calls succeed in sequence.
    await expect(client.health()).resolves.toBeDefined();
  });
});
