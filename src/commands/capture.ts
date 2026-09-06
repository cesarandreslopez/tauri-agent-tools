import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import type { PlatformAdapter, AdapterFactory } from '../types.js';
import type { ImageFormat } from '../schemas/commands.js';
import { addBridgeOptions, resolveBridge, resolveWindowId, parseNonNegativeInt } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { buildSerializerScript } from './dom.js';
import { computeCropRect, cropImage } from '../util/image.js';
import { DomNodeSchema } from '../schemas/dom.js';
import { PageStateSchema, SnapshotStorageResultSchema } from '../schemas/commands.js';
import type { CaptureManifest } from '../schemas/commands.js';
import type { BridgeClient } from '../bridge/client.js';
import { consoleObserver, readObserver, closeObserver } from '../bridge/observers.js';
import { ConsoleEntrySchema } from '../schemas/commands.js';
import { z } from 'zod';
import { monitorFor } from '../util/monitor.js';
import { readRustLogs } from '../bridge/logReader.js';
import { evaluateExpression } from '../bridge/evaluate.js';

const PAGE_STATE_SCRIPT = `(() => {
  return JSON.stringify({
    url: window.location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    hasTauri: !!(window.__TAURI_INTERNALS__ || window.__TAURI__)
  });
})()`;

const STORAGE_SCRIPT = `(() => {
  var local = Object.keys(localStorage).map(function(k) { return { key: k, value: localStorage.getItem(k) }; });
  var session = Object.keys(sessionStorage).map(function(k) { return { key: k, value: sessionStorage.getItem(k) }; });
  return JSON.stringify({ localStorage: local, sessionStorage: session });
})()`;

export interface CaptureToDirOptions {
  output: string;
  selector?: string;
  title?: string;
  windowId?: string;
  domDepth: number;
  eval?: string;
  logsDuration: number;
}

export async function captureToDir(
  bridge: BridgeClient,
  adapter: PlatformAdapter | AdapterFactory,
  opts: CaptureToDirOptions,
): Promise<CaptureManifest> {
  const outDir = opts.output;
  const format: ImageFormat = 'png';
  const files: Record<string, string> = {};

  // 1. Create output directory
  await mkdir(outDir, { recursive: true });

  const scripts = consoleObserver();
  let observerError: unknown;
  let closed = false;
  const warnings: string[] = [];
  const warn = (message: string) => { warnings.push(message); console.error(message); };
  try {
    // 2. Subscribe without affecting other console consumers.
    try {
      const status = await bridge.eval(scripts.patch);
      if (status !== 'patched') throw new Error(`Observer setup failed: ${String(status)}`);
    } catch (error) {
      observerError = error;
    }

    // 3. Get page state — save to page-state.json
    let capturedUrl: string | undefined;
    let capturedTitle: string | undefined;
    let capturedViewport: { width: number; height: number } | undefined;
    try {
      const raw = await bridge.eval(PAGE_STATE_SCRIPT);
      const parsed = PageStateSchema.parse(JSON.parse(String(raw)));
      capturedUrl = parsed.url;
      capturedTitle = parsed.title;
      capturedViewport = parsed.viewport;
      const path = join(outDir, 'page-state.json');
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files['page-state.json'] = path;
    } catch (err) {
      files['page-state.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 4. Screenshot — missing platform tools must not prevent other artifacts.
    try {
      const screenshotAdapter = typeof adapter === 'function' ? await adapter(opts.selector ? 'image' : 'capture') : adapter;
      const windowId = await resolveWindowId(screenshotAdapter, bridge, opts);
      let buffer: Buffer;
      if (opts.selector) {
        const elementRect = await bridge.getElementRect(opts.selector);
        if (!elementRect) throw new Error(`Element not found: ${opts.selector}`);
        const viewport = await bridge.getViewportSize();
        const windowGeom = await screenshotAdapter.getWindowGeometry(windowId);
        buffer = await screenshotAdapter.captureWindow(windowId, format);
        const cropRect = computeCropRect(elementRect, viewport, {
          width: windowGeom.width,
          height: windowGeom.height,
        });
        buffer = await cropImage(buffer, cropRect, format);
      } else {
        buffer = await screenshotAdapter.captureWindow(windowId, format);
      }
      const path = join(outDir, 'screenshot.png');
      await writeFile(path, buffer);
      files['screenshot.png'] = path;
    } catch (err) {
      files['screenshot.png'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 5. DOM tree — save to dom.json
    try {
      const raw = await bridge.eval(buildSerializerScript('body', opts.domDepth, false));
      const parsed = DomNodeSchema.parse(JSON.parse(String(raw)));
      const path = join(outDir, 'dom.json');
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files['dom.json'] = path;
    } catch (err) {
      files['dom.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 6. Storage — save to storage.json
    try {
      const raw = await bridge.eval(STORAGE_SCRIPT);
      const parsed = SnapshotStorageResultSchema.parse(JSON.parse(String(raw)));
      const path = join(outDir, 'storage.json');
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files['storage.json'] = path;
    } catch (err) {
      files['storage.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 7. Wait for logs-duration, drain console errors — save to console-errors.json
    try {
      if (observerError) throw observerError;
      const errors: Array<{ ts: number; msg: string }> = [];
      await monitorFor({ interval: Math.min(500, opts.logsDuration), duration: opts.logsDuration }, async () => {
        const entries = z.array(ConsoleEntrySchema).parse(await readObserver(bridge, scripts, warn));
        errors.push(...entries.filter(e => e.level === 'error').map(e => ({ ts: e.timestamp, msg: e.message })));
      });
      const path = join(outDir, 'console-errors.json');
      await writeFile(path, JSON.stringify(errors, null, 2));
      files['console-errors.json'] = path;
    } catch (err) {
      files['console-errors.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 8. Fetch rust logs — save to rust-logs.json
    try {
      const logs = await readRustLogs(bridge, undefined, { warn });
      const path = join(outDir, 'rust-logs.json');
      await writeFile(path, JSON.stringify(logs, null, 2));
      files['rust-logs.json'] = path;
    } catch (err) {
      files['rust-logs.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 9. Optional custom eval — save to eval.json
    if (opts.eval) {
      try {
        const { value: raw } = await evaluateExpression(bridge, opts.eval);
        const parsed = typeof raw === 'string'
          ? (() => { try { return JSON.parse(raw); } catch { return raw; } })()
          : raw;
        const path = join(outDir, 'eval.json');
        await writeFile(path, JSON.stringify(parsed, null, 2));
        files['eval.json'] = path;
      } catch (err) {
        files['eval.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 10. Write manifest.json
    await closeObserver(bridge, scripts, warn);
    closed = true;
    const errorCount = Object.values(files).filter(v => v.startsWith('error: ')).length;
    const manifest = {
      timestamp: new Date().toISOString(),
      url: capturedUrl,
      title: capturedTitle,
      viewport: capturedViewport,
      errorCount,
      partial: errorCount > 0 || warnings.length > 0,
      warnings,
      files,
    };
    const manifestPath = join(outDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return manifest;
  } finally {
    if (!closed) await closeObserver(bridge, scripts, warn);
  }
}

export function registerCapture(
  program: Command,
  getAdapter: AdapterFactory,
): void {
  const cmd = new Command('capture')
    .description('Capture enhanced snapshot with manifest directory (screenshot, DOM, state, logs, errors)')
    .requiredOption('-o, --output <dir>', 'Output directory path')
    .option('-s, --selector <css>', 'CSS selector to screenshot (full window if omitted)')
    .option('-t, --title <pattern>', 'Window title (X11: regex; macOS/Wayland: substring); quote titles with spaces (default: auto-discover)')
    .option('-w, --window-id <id>', 'Platform window id (from list-windows) — overrides --title')
    .option('--dom-depth <number>', 'DOM tree depth', parseNonNegativeInt, 3)
    .option('--eval <js>', 'Additional JS to eval and save')
    .option('--logs-duration <ms>', 'Duration to wait for console errors (ms)', parseNonNegativeInt, 3000)
    .option('--json', 'Output structured manifest');

  addBridgeOptions(cmd);

  cmd.action(async (opts: CaptureToDirOptions & BridgeOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const manifest = await captureToDir(bridge, getAdapter, opts);
    printCaptureManifest(opts.output, manifest, opts.json);
  });

  program.addCommand(cmd);
}

function printCaptureManifest(
  outDir: string,
  manifest: CaptureManifest,
  json: boolean | undefined,
): void {
  if (json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  console.log(`Capture: ${outDir}`);
  console.log(`Time:    ${manifest.timestamp}`);
  if (manifest.url) console.log(`URL:     ${manifest.url}`);
  if (manifest.title) console.log(`Title:   ${manifest.title}`);
  console.log('');
  for (const [key, value] of Object.entries(manifest.files)) {
    const isError = value.startsWith('error: ');
    const status = isError ? 'FAIL' : '  OK';
    console.log(`[${status}] ${key}: ${value}`);
  }
  if ((manifest.errorCount ?? 0) > 0) {
    console.log(`\n${manifest.errorCount} artifact(s) failed.`);
  }
}
