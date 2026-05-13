import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');
const TOKEN = 'tier2-cmd-token';

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

beforeAll(async () => {
  modern = await spinServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          version: '0.7.0',
          endpoints: [
            '/eval',
            '/logs',
            '/describe',
            '/version',
            '/process',
            '/capabilities',
            '/devtools',
            '/health',
          ],
        }),
      );
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
      const reply = (payload: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/process') {
        reply({
          tauri: { pid: 1234, exe: '/bin/app', args: [], uptime_ms: 7500 },
          sidecars: [{ name: 'helper', pid: 5678, args: [], alive: true }],
        });
        return;
      }
      if (req.url === '/capabilities') {
        reply({
          declared: [
            {
              identifier: 'default',
              windows: ['main'],
              permissions: ['core:default', 'fs:allow-all', '*'],
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
          uptime_ms: 7500,
          webview_ready: true,
          sidecars_alive: true,
          sidecars: [{ name: 'helper', pid: 5678, args: [], alive: true }],
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
});

afterAll(async () => {
  await modern.close();
  await oldBridge.close();
});

describe('Tier 2 commands (e2e via dist/cli.js)', () => {
  it('process-tree --json returns structured process info', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'process-tree',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
      '--json',
    ]);
    const out = JSON.parse(stdout);
    expect(out.tauri.pid).toBe(1234);
    expect(out.sidecars).toHaveLength(1);
    expect(out.sidecars[0].alive).toBe(true);
  });

  it('process-tree human output renders a tree shape', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'process-tree',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
    ]);
    expect(stdout).toContain('tauri  pid=1234');
    expect(stdout).toMatch(/└──.*helper/);
  });

  it('capabilities audit flags wildcard "*" as error and fs:allow-all as warn', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'capabilities',
      'audit',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
      '--json',
    ]);
    const out = JSON.parse(stdout);
    const errors = out.findings.filter((f: { level: string }) => f.level === 'error');
    const warns = out.findings.filter((f: { level: string }) => f.level === 'warn');
    expect(errors.some((f: { message: string }) => f.message.includes('wildcard'))).toBe(true);
    expect(warns.some((f: { message: string }) => f.message.includes('fs:allow-all'))).toBe(true);
  });

  it('webview attach --json returns the devtools envelope', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'webview',
      'attach',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
      '--json',
    ]);
    const out = JSON.parse(stdout);
    expect(out.platform).toBe('wkwebview');
    expect(out.inspectable).toBe(true);
  });

  it('webview attach --print-url emits the URL alone', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'webview',
      'attach',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
      '--print-url',
    ]);
    expect(stdout.trim()).toBe(''); // fixture returns url:null
  });

  it('health --json returns the health envelope and exits 0 when healthy', async () => {
    const { stdout } = await execFileP('node', [
      CLI,
      'health',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
      '--json',
    ]);
    const out = JSON.parse(stdout);
    expect(out.webview_ready).toBe(true);
    expect(out.sidecars_alive).toBe(true);
  });

  it('process-tree surfaces an actionable error against an old bridge', async () => {
    await expect(
      execFileP('node', [
        CLI,
        'process-tree',
        '--port',
        String(oldBridge.port),
        '--token',
        TOKEN,
        '--json',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/v0\.7\.0\+.*dev_bridge\.rs/),
    });
  });
});
