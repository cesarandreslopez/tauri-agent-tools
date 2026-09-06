import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { BridgeClient } from '../../src/bridge/client.js';
import { captureToDir } from '../../src/commands/capture.js';
import { registerCheck } from '../../src/commands/check.js';
import { registerConsoleMonitor } from '../../src/commands/consoleMonitor.js';
import { readRustLogs, newLogCursor } from '../../src/bridge/logReader.js';
import { webview } from '../helpers/webview.js';

let fixture: ReturnType<typeof webview>;
let dir: string;
let client: BridgeClient;
const originalExit = process.exitCode;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'collector-lifecycle-'));
  fixture = webview();
  vi.spyOn(fixture.window.console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  client = new BridgeClient({ port: 9999, token: 'fixture' });
  client.eval = vi.fn(fixture.bridge.eval);
  client.fetchLogs = vi.fn(async () => ({ entries: [], cursor: 0, dropped: 0 })) as never;
});
afterEach(async () => {
  fixture.close(); await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = originalExit;
});
const noScreenshot = () => { throw new Error('Missing screenshot dependency'); };
const options = () => ({ output: dir, windowId: '123', domDepth: 2, logsDuration: 0 });

describe('collector lifecycle', () => {
  it('preserves other capture artifacts and restores console when screenshot tools are missing', async () => {
    const original = fixture.window.console.error;
    const manifest = await captureToDir(client, noScreenshot, options());
    expect(manifest).toMatchObject({ partial: true, errorCount: 1, warnings: [] });
    expect(manifest.files['screenshot.png']).toContain('Missing screenshot dependency');
    expect(JSON.parse(await readFile(join(dir, 'storage.json'), 'utf8'))).toHaveProperty('localStorage');
    expect(fixture.window.console.error).toBe(original);
    expect(fixture.window.__tauriAgentConsole).toBeUndefined();
  });
  it('records cleanup errors in the saved manifest', async () => {
    client.eval = vi.fn(async script => {
      if (script.includes("return 'cleaned'")) return 'ERROR: cleanup fixture failure';
      return fixture.bridge.eval(script);
    });
    const manifest = await captureToDir(client, noScreenshot, options());
    expect(manifest.warnings).toContain('warning: observer cleanup failed: ERROR: cleanup fixture failure');
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).warnings).toEqual(manifest.warnings);
  });
  it('restores the console even if writing the manifest fails', async () => {
    await mkdir(join(dir, 'manifest.json'));
    const original = fixture.window.console.error;
    await expect(captureToDir(client, noScreenshot, options())).rejects.toThrow();
    expect(fixture.window.console.error).toBe(original);
  });
  it('capture and a concurrent Rust log reader each receive the same retained entry', async () => {
    const entries = [{ id: 1, timestamp: 1, level: 'INFO', target: 'fixture', message: 'retained' }];
    client.fetchLogs = vi.fn(async opts => ({
      entries: entries.filter(e => e.id > opts.cursor), cursor: 1, dropped: 0,
    })) as never;
    const cursor = newLogCursor();
    const [logs] = await Promise.all([
      readRustLogs(client, cursor),
      captureToDir(client, noScreenshot, options()),
    ]);
    expect(logs).toEqual(entries);
    expect(JSON.parse(await readFile(join(dir, 'rust-logs.json'), 'utf8'))).toEqual(entries);
    expect(await readRustLogs(client, cursor)).toEqual([]);
    expect(vi.mocked(client.fetchLogs).mock.calls.map(([opts]) => opts.cursor)).toEqual([0, 0, 1]);
  });
  it('checks console errors with a final sample and cleans up afterward', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const script = JSON.parse(opts.body).js;
      const result = await fixture.bridge.eval(script);
      if (script.includes("return 'patched'")) fixture.window.console.error('late error');
      return new Response(JSON.stringify({ result }));
    }));
    const original = fixture.window.console.error;
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride(); registerCheck(program);
    await program.parseAsync(['node', 'fixture', 'check', '--no-errors', '--duration', '5',
      '--port', '9999', '--token', 'fixture', '--json']);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      passed: false, checks: [{ type: 'no-errors', errors: ['late error'] }],
    });
    expect(fixture.window.console.error).toBe(original);
  });
  it.each(['SIGINT', 'SIGTERM'])('finalizes a monitor on %s and removes signal handlers', async signal => {
    const baseline = process.listenerCount(signal);
    const original = fixture.window.console.error;
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const script = JSON.parse(opts.body).js;
      const result = await fixture.bridge.eval(script);
      if (script.includes("return 'patched'")) {
        setTimeout(() => { fixture.window.console.error('before stop'); process.emit(signal); }, 10);
      }
      return new Response(JSON.stringify({ result }));
    }));
    const program = new Command().exitOverride(); registerConsoleMonitor(program);
    await program.parseAsync(['node', 'fixture', 'console-monitor', '--interval', '10000',
      '--duration', '20000', '--port', '9999', '--token', 'fixture', '--json']);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('before stop'));
    expect(fixture.window.console.error).toBe(original);
    expect(process.listenerCount(signal)).toBe(baseline);
  });
  it('cleans up an observer whose setup reply is lost', async () => {
    const original = fixture.window.console.error;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const script = JSON.parse(opts.body).js;
      const result = await fixture.bridge.eval(script);
      if (script.includes("return 'patched'")) throw new Error('lost setup response');
      return new Response(JSON.stringify({ result }));
    }));
    const program = new Command().exitOverride(); registerConsoleMonitor(program);
    await expect(program.parseAsync(['node', 'fixture', 'console-monitor', '--duration', '10',
      '--port', '9999', '--token', 'fixture', '--json'])).rejects.toThrow('lost setup response');
    expect(fixture.window.console.error).toBe(original);
  });
});
