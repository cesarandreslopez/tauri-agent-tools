import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli.js');
const TOKEN = 'tier3-test-token';

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

let workspace: string;
let modern: { port: number; close: () => Promise<void> };

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'diagnose-test-'));

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
          tauri: { pid: 9999, args: [], uptime_ms: 4200 },
          sidecars: [{ name: 'helper', pid: 8888, args: [], alive: true }],
        });
        return;
      }
      if (req.url === '/capabilities') {
        reply({ declared: [{ identifier: 'default', windows: ['main'], permissions: [] }], windows: ['main'] });
        return;
      }
      if (req.url === '/devtools') {
        reply({ platform: 'wkwebview', inspectable: true, url: null, hint: 'Safari Develop menu' });
        return;
      }
      if (req.url === '/health') {
        reply({ uptime_ms: 4200, webview_ready: true, sidecars_alive: true, sidecars: [] });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
  });
});

afterAll(async () => {
  rmSync(workspace, { recursive: true, force: true });
  await modern.close();
});

function scaffold(name: string, files: Record<string, string>): string {
  const root = join(workspace, name);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('diagnose command (e2e)', () => {
  it('with --no-bridge produces a forensics-only bundle and an explanatory summary', async () => {
    const project = scaffold('proj-nobridge', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.diag.test',
        productName: 'DiagTest',
      }),
    });
    const out = join(workspace, 'out-nobridge');
    await execFileP('node', [
      CLI,
      'diagnose',
      '--config',
      project,
      '-o',
      out,
      '--logs-duration',
      '200',
      '--no-bridge',
    ]);
    expect(existsSync(join(out, 'summary.md'))).toBe(true);
    expect(existsSync(join(out, 'summary.json'))).toBe(true);
    expect(existsSync(join(out, 'forensics', 'summary.md'))).toBe(true);
    expect(existsSync(join(out, 'bridge.json'))).toBe(true);

    const bridgeData = JSON.parse(readFileSync(join(out, 'bridge.json'), 'utf-8'));
    expect(bridgeData.reachable).toBe(false);
    const md = readFileSync(join(out, 'summary.md'), 'utf-8');
    expect(md).toContain('No live dev bridge');
    expect(md).toContain('forensics/summary.md');
  });

  it('with a reachable bridge enriches the bundle with /process, /capabilities, /devtools, /health', async () => {
    const project = scaffold('proj-bridge', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.diag.bridge',
        productName: 'DiagBridge',
      }),
    });
    const out = join(workspace, 'out-bridge');
    await execFileP('node', [
      CLI,
      'diagnose',
      '--config',
      project,
      '-o',
      out,
      '--logs-duration',
      '200',
      '--port',
      String(modern.port),
      '--token',
      TOKEN,
    ]);
    const bridgeData = JSON.parse(readFileSync(join(out, 'bridge.json'), 'utf-8'));
    expect(bridgeData.reachable).toBe(true);
    expect(bridgeData.version).toBe('0.7.0');
    expect(bridgeData.process.tauri.pid).toBe(9999);
    expect(bridgeData.health.webview_ready).toBe(true);
    expect(bridgeData.devtools.platform).toBe('wkwebview');

    const md = readFileSync(join(out, 'summary.md'), 'utf-8');
    expect(md).toContain('Bridge v0.7.0 responded');
    expect(md).toContain('Tauri pid `9999`');
    expect(md).toContain('Webview ready: yes');
  });

  it('--json prints the master summary to stdout', async () => {
    const project = scaffold('proj-json', {
      'src-tauri/tauri.conf.json': JSON.stringify({
        identifier: 'com.diag.json',
        productName: 'DiagJson',
      }),
    });
    const out = join(workspace, 'out-json');
    const { stdout } = await execFileP('node', [
      CLI,
      'diagnose',
      '--config',
      project,
      '-o',
      out,
      '--logs-duration',
      '200',
      '--no-bridge',
      '--json',
    ]);
    const master = JSON.parse(stdout);
    expect(master.identifier).toBe('com.diag.json');
    expect(master.bridgeReachable).toBe(false);
    expect(master.outDir).toBe(out);
    expect(Array.isArray(master.phases)).toBe(true);
  });

  it('errors gracefully when config cannot be resolved AND forensics also fails', async () => {
    // Point at a directory with no tauri.conf.json. Forensics subprocess will fail.
    const bogus = scaffold('proj-broken', { 'empty.txt': '' });
    const out = join(workspace, 'out-broken');
    // diagnose itself still exits 0 — the failure is recorded as a phase outcome.
    await execFileP('node', [
      CLI,
      'diagnose',
      '--config',
      bogus,
      '-o',
      out,
      '--logs-duration',
      '200',
      '--no-bridge',
    ]);
    const master = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'));
    const phases = master.phases as Array<{ phase: string; ok: boolean }>;
    expect(phases.some((p) => p.phase === 'resolve-config' && !p.ok)).toBe(true);
    expect(phases.some((p) => p.phase === 'forensics' && !p.ok)).toBe(true);
  });
});
