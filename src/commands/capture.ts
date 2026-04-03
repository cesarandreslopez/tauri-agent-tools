import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import type { PlatformAdapter } from '../types.js';
import type { ImageFormat } from '../schemas/commands.js';
import { addBridgeOptions, resolveBridge } from './shared.js';
import { buildSerializerScript } from './dom.js';
import { computeCropRect, cropImage } from '../util/image.js';
import { DomNodeSchema } from '../schemas/dom.js';
import { PageStateSchema, SnapshotStorageResultSchema } from '../schemas/commands.js';
import type { BridgeClient } from '../bridge/client.js';

const PAGE_STATE_SCRIPT = `(() => {
  return JSON.stringify({
    url: window.location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    hasTauri: !!(window.__TAURI__)
  });
})()`;

const STORAGE_SCRIPT = `(() => {
  var local = Object.keys(localStorage).map(function(k) { return { key: k, value: localStorage.getItem(k) }; });
  var session = Object.keys(sessionStorage).map(function(k) { return { key: k, value: sessionStorage.getItem(k) }; });
  return JSON.stringify({ localStorage: local, sessionStorage: session });
})()`;

const INJECT_CONSOLE_ERROR_SCRIPT = `(() => {
  if (!window.__captureErrors) {
    window.__captureErrors = [];
    const orig = console.error.bind(console);
    console.error = function(...args) {
      window.__captureErrors.push({ ts: Date.now(), msg: args.map(String).join(' ') });
      orig(...args);
    };
  }
  return 'ok';
})()`;

const DRAIN_CONSOLE_ERRORS_SCRIPT = `(() => {
  var errs = window.__captureErrors || [];
  window.__captureErrors = [];
  return JSON.stringify(errs);
})()`;

async function resolveWindowId(
  adapter: PlatformAdapter,
  bridge: BridgeClient,
  title?: string,
): Promise<string> {
  if (title) return adapter.findWindow(title);
  const docTitle = await bridge.getDocumentTitle();
  if (!docTitle) throw new Error('Could not get window title. Use --title.');
  return adapter.findWindow(docTitle);
}

export function registerCapture(
  program: Command,
  getAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
): void {
  const cmd = new Command('capture')
    .description('Capture enhanced snapshot with manifest directory (screenshot, DOM, state, logs, errors)')
    .requiredOption('-o, --output <dir>', 'Output directory path')
    .option('-s, --selector <css>', 'CSS selector to screenshot (full window if omitted)')
    .option('-t, --title <regex>', 'Window title to match (default: auto-discover)')
    .option('--dom-depth <number>', 'DOM tree depth', parseInt, 3)
    .option('--eval <js>', 'Additional JS to eval and save')
    .option('--logs-duration <ms>', 'Duration to wait for console errors (ms)', parseInt, 3000)
    .option('--json', 'Output structured manifest');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    output: string;
    selector?: string;
    title?: string;
    domDepth: number;
    eval?: string;
    logsDuration: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const bridge = await resolveBridge(opts);
    const adapter = await getAdapter();
    const outDir = opts.output;
    const format: ImageFormat = 'png';
    const files: Record<string, string> = {};

    // 1. Create output directory
    await mkdir(outDir, { recursive: true });

    // 2. Inject console error capture
    try {
      await bridge.eval(INJECT_CONSOLE_ERROR_SCRIPT);
    } catch {
      // Non-fatal — continue without error capture
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

    // 4. Screenshot — save to screenshot.png
    try {
      const windowId = await resolveWindowId(adapter, bridge, opts.title);
      let buffer: Buffer;
      if (opts.selector) {
        const elementRect = await bridge.getElementRect(opts.selector);
        if (!elementRect) throw new Error(`Element not found: ${opts.selector}`);
        const viewport = await bridge.getViewportSize();
        const windowGeom = await adapter.getWindowGeometry(windowId);
        buffer = await adapter.captureWindow(windowId, format);
        const cropRect = computeCropRect(elementRect, viewport, {
          width: windowGeom.width,
          height: windowGeom.height,
        });
        buffer = await cropImage(buffer, cropRect, format);
      } else {
        buffer = await adapter.captureWindow(windowId, format);
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
      await new Promise<void>((resolve) => setTimeout(resolve, opts.logsDuration));
      const raw = await bridge.eval(DRAIN_CONSOLE_ERRORS_SCRIPT);
      const errors = JSON.parse(String(raw)) as unknown[];
      const path = join(outDir, 'console-errors.json');
      await writeFile(path, JSON.stringify(errors, null, 2));
      files['console-errors.json'] = path;
    } catch (err) {
      files['console-errors.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 8. Fetch rust logs — save to rust-logs.json
    try {
      const logs = await bridge.fetchLogs();
      const path = join(outDir, 'rust-logs.json');
      await writeFile(path, JSON.stringify(logs, null, 2));
      files['rust-logs.json'] = path;
    } catch (err) {
      files['rust-logs.json'] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 9. Optional custom eval — save to eval.json
    if (opts.eval) {
      try {
        const raw = await bridge.eval(opts.eval);
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
    const errorCount = Object.values(files).filter(v => v.startsWith('error: ')).length;
    const manifest = {
      timestamp: new Date().toISOString(),
      url: capturedUrl,
      title: capturedTitle,
      viewport: capturedViewport,
      errorCount,
      files,
    };
    const manifestPath = join(outDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // 11. Output
    if (opts.json) {
      console.log(JSON.stringify(manifest, null, 2));
    } else {
      console.log(`Capture: ${outDir}`);
      console.log(`Time:    ${manifest.timestamp}`);
      if (capturedUrl) console.log(`URL:     ${capturedUrl}`);
      if (capturedTitle) console.log(`Title:   ${capturedTitle}`);
      console.log('');
      for (const [key, value] of Object.entries(files)) {
        const isError = value.startsWith('error: ');
        const status = isError ? 'FAIL' : '  OK';
        console.log(`[${status}] ${key}: ${value}`);
      }
      if (errorCount > 0) {
        console.log(`\n${errorCount} artifact(s) failed.`);
      }
    }
  });

  program.addCommand(cmd);
}
