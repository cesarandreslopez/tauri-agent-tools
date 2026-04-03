import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BridgeClient } from '../../src/bridge/client.js';

const TEST_TOKEN = 'test-secret-token';

let server: ReturnType<typeof createServer>;
let port: number;
let lastRequestBody: Record<string, unknown> | undefined;

const SAMPLE_LOG_ENTRIES = [
  { timestamp: 1700000000000, level: 'info', target: 'myapp::db', message: 'Connected', source: 'rust' },
  { timestamp: 1700000001000, level: 'warn', target: 'myapp::api', message: 'Slow query', source: 'rust' },
];

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST' || (req.url !== '/eval' && req.url !== '/logs')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
  req.on('end', () => {
    const data = JSON.parse(body) as Record<string, unknown>;
    lastRequestBody = data;

    if (data.token !== TEST_TOKEN) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    // Handle /logs endpoint
    if (req.url === '/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries: SAMPLE_LOG_ENTRIES }));
      return;
    }

    try {
      // Simulate evaluating JS (just return the expression as a string for testing)
      let result: unknown;
      if (data.js === '1') {
        result = 1;
      } else if (data.js === 'document.title') {
        result = 'Test App';
      } else if (data.js.includes('getBoundingClientRect')) {
        result = JSON.stringify({ x: 10, y: 20, width: 300, height: 200 });
      } else if (data.js.includes('innerWidth')) {
        result = JSON.stringify({ width: 1920, height: 1080 });
      } else if (data.js === 'throw_error') {
        res.writeHead(500);
        res.end('Internal error');
        return;
      } else {
        result = data.js;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch {
      res.writeHead(500);
      res.end('Eval error');
    }
  });
}

beforeAll(async () => {
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('BridgeClient', () => {
  function client(token = TEST_TOKEN, windowLabel?: string) {
    return new BridgeClient({ port, token }, windowLabel);
  }

  beforeEach(() => {
    lastRequestBody = undefined;
  });

  describe('eval', () => {
    it('evaluates expressions and returns results', async () => {
      const result = await client().eval('document.title');
      expect(result).toBe('Test App');
    });

    it('returns numeric results', async () => {
      const result = await client().eval('1');
      expect(result).toBe(1);
    });
  });

  describe('windowLabel', () => {
    it('includes window field in eval request body when windowLabel is set', async () => {
      await client(TEST_TOKEN, 'overlay').eval('1');
      expect(lastRequestBody).toBeDefined();
      expect(lastRequestBody!.window).toBe('overlay');
    });

    it('does NOT include window key in eval request body without windowLabel', async () => {
      await client().eval('1');
      expect(lastRequestBody).toBeDefined();
      expect('window' in lastRequestBody!).toBe(false);
    });
  });

  describe('authentication', () => {
    it('throws on invalid token', async () => {
      await expect(client('wrong-token').eval('1')).rejects.toThrow(
        'Bridge authentication failed',
      );
    });
  });

  describe('getElementRect', () => {
    it('parses element rect from bridge response', async () => {
      const rect = await client().getElementRect('.toolbar');
      expect(rect).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    });
  });

  describe('getViewportSize', () => {
    it('returns viewport dimensions', async () => {
      const size = await client().getViewportSize();
      expect(size).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe('ping', () => {
    it('returns true when bridge is alive', async () => {
      expect(await client().ping()).toBe(true);
    });

    it('returns false for wrong port', async () => {
      const badClient = new BridgeClient({ port: 1, token: TEST_TOKEN });
      expect(await badClient.ping()).toBe(false);
    });
  });

  describe('fetchLogs', () => {
    it('returns log entries from /logs endpoint', async () => {
      const entries = await client().fetchLogs();
      expect(entries).toEqual(SAMPLE_LOG_ENTRIES);
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('info');
      expect(entries[1].target).toBe('myapp::api');
    });

    it('throws on authentication failure', async () => {
      await expect(client('wrong-token').fetchLogs()).rejects.toThrow(
        'Bridge authentication failed',
      );
    });

    it('throws "update your bridge" on 404', async () => {
      // Create a server that always returns 404 for /logs
      const notFoundServer = createServer((req, res) => {
        res.writeHead(404);
        res.end('Not found');
      });
      const notFoundPort = await new Promise<number>((resolve) => {
        notFoundServer.listen(0, '127.0.0.1', () => {
          resolve((notFoundServer.address() as AddressInfo).port);
        });
      });

      try {
        const badClient = new BridgeClient({ port: notFoundPort, token: TEST_TOKEN });
        await expect(badClient.fetchLogs()).rejects.toThrow(
          'Bridge does not support /logs',
        );
      } finally {
        await new Promise<void>((resolve) => notFoundServer.close(() => resolve()));
      }
    });
  });

  describe('error handling', () => {
    it('throws on server error', async () => {
      await expect(client().eval('throw_error')).rejects.toThrow('Bridge error (500)');
    });

    it('throws on connection refused', async () => {
      const badClient = new BridgeClient({ port: 1, token: TEST_TOKEN });
      await expect(badClient.eval('test')).rejects.toThrow();
    });
  });
});
