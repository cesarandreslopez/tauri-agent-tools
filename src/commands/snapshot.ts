import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import type { PlatformAdapter, ImageFormat } from '../types.js';
import { addBridgeOptions, resolveBridge } from './shared.js';
import { buildSerializerScript } from './dom.js';
import { computeCropRect, cropImage } from '../util/image.js';
import type { BridgeClient } from '../bridge/client.js';
import { DomNodeSchema, PageStateSchema, SnapshotStorageResultSchema } from '../schemas.js';

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

export function registerSnapshot(
  program: Command,
  getAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
): void {
  const cmd = new Command('snapshot')
    .description('Capture screenshot + DOM + page state + storage in one shot')
    .requiredOption('-o, --output <prefix>', 'Output path prefix (e.g. /tmp/debug)')
    .option('-s, --selector <css>', 'CSS selector to screenshot (full window if omitted)')
    .option('-t, --title <regex>', 'Window title to match (default: auto-discover)')
    .option('--dom-depth <number>', 'DOM tree depth', parseInt, 3)
    .option('--eval <js>', 'Additional JS to eval and save')
    .option('--json', 'Output structured manifest');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    output: string;
    selector?: string;
    title?: string;
    domDepth: number;
    eval?: string;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const bridge = await resolveBridge(opts);
    const adapter = await getAdapter();
    const prefix = opts.output;
    const format: ImageFormat = 'png';
    const files: Record<string, string> = {};

    // 1. Screenshot
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
      const path = `${prefix}-screenshot.png`;
      await writeFile(path, buffer);
      files.screenshot = path;
    } catch (err) {
      files.screenshot = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 2. DOM
    try {
      const raw = await bridge.eval(buildSerializerScript('body', opts.domDepth, false));
      const parsed = DomNodeSchema.parse(JSON.parse(String(raw)));
      const path = `${prefix}-dom.json`;
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files.dom = path;
    } catch (err) {
      files.dom = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 3. Page state
    try {
      const raw = await bridge.eval(PAGE_STATE_SCRIPT);
      const parsed = PageStateSchema.parse(JSON.parse(String(raw)));
      const path = `${prefix}-page-state.json`;
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files.pageState = path;
    } catch (err) {
      files.pageState = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 4. Storage
    try {
      const raw = await bridge.eval(STORAGE_SCRIPT);
      const parsed = SnapshotStorageResultSchema.parse(JSON.parse(String(raw)));
      const path = `${prefix}-storage.json`;
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files.storage = path;
    } catch (err) {
      files.storage = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 5. Custom eval (optional)
    if (opts.eval) {
      try {
        const raw = await bridge.eval(opts.eval);
        const path = `${prefix}-eval.json`;
        const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw;
        await writeFile(path, JSON.stringify(parsed, null, 2));
        files.eval = path;
      } catch (err) {
        files.eval = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(files, null, 2));
    } else {
      for (const [key, path] of Object.entries(files)) {
        console.log(`${key}: ${path}`);
      }
    }
  });

  program.addCommand(cmd);
}
