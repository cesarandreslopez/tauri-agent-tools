import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');
const TOKEN = 'degrade-token';

/**
 * A v0.6.0-era fake bridge: advertises only /eval, /logs, /describe, /version —
 * none of the v0.7 structured endpoints. This is exactly contextful's shape.
 */
function spinOldBridge(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && req.url === '/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.6.0', endpoints: ['/eval', '/logs', '/describe', '/version'] }));
        return;
      }
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const data = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        if (data.token !== TOKEN) {
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }
        if (req.url === '/eval') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '1' }));
          return;
        }
        if (req.url === '/logs') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ entries: [] }));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

let old: { port: number; close: () => Promise<void> };

beforeAll(async () => {
  old = await spinOldBridge();
});
afterAll(async () => {
  await old.close();
});

const base = (): string[] => ['--port', String(old.port), '--token', TOKEN];

describe('graceful degradation against a v0.6.0 bridge', () => {
  it('health --json degrades (available:false) instead of throwing', async () => {
    const { stdout } = await execFileP('node', [CLI, 'health', ...base(), '--json']);
    const out = JSON.parse(stdout);
    expect(out.available).toBe(false);
    expect(out.endpoint).toBe('/health');
  });

  it('health --strict re-raises the actionable upgrade error', async () => {
    await expect(execFileP('node', [CLI, 'health', ...base(), '--strict', '--json'])).rejects.toMatchObject({
      stderr: expect.stringMatching(/v0\.7\.0\+/),
    });
  });

  it('capabilities audit --json degrades instead of throwing', async () => {
    const { stdout } = await execFileP('node', [CLI, 'capabilities', 'audit', ...base(), '--json']);
    expect(JSON.parse(stdout).available).toBe(false);
  });

  it('webview attach --json degrades instead of throwing', async () => {
    const { stdout } = await execFileP('node', [CLI, 'webview', 'attach', ...base(), '--json']);
    expect(JSON.parse(stdout).available).toBe(false);
  });

  it('process-tree with no resolvable PID re-raises the actionable error', async () => {
    await expect(execFileP('node', [CLI, 'process-tree', ...base(), '--json'])).rejects.toMatchObject({
      stderr: expect.stringMatching(/v0\.7\.0\+.*dev_bridge\.rs/),
    });
  });
});
