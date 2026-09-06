import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import type { AdapterFactory } from '../types.js';
import { ImageFormatSchema } from '../schemas/commands.js';
import type { ImageFormat } from '../schemas/commands.js';
import { addBridgeOptions, resolveBridge, resolveWindowId, parsePositiveInt } from './shared.js';
import { computeCropRect, cropImage, resizeImage } from '../util/image.js';

function autoOutputPath(format: ImageFormat): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `screenshot-${ts}.${format}`;
}

export function registerScreenshot(
  program: Command,
  getAdapter: AdapterFactory,
): void {
  const cmd = new Command('screenshot')
    .description('Capture a screenshot of a window or DOM element')
    .option('-s, --selector <css>', 'CSS selector — screenshot just this element (requires bridge)')
    .option('-t, --title <pattern>', 'Window title (X11: regex; macOS/Wayland: substring); quote titles with spaces (default: auto-discover from bridge)')
    .option('-w, --window-id <id>', 'Platform window id (from list-windows) — overrides --title')
    .option('-o, --output <path>', 'Output file path (default: auto-named)')
    .option('--format <fmt>', 'Output format: png or jpg', 'png')
    .option('--max-width <number>', 'Resize to max width', parsePositiveInt)
    .option('--json', 'Output structured JSON metadata')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools screenshot --title "My App"
  $ tauri-agent-tools screenshot --window-id 12345 -o win.png   # id from list-windows, no bridge needed
  $ tauri-agent-tools screenshot --selector ".sidebar" --output sidebar.png
  $ tauri-agent-tools screenshot --selector "#login" --format jpg --json`);

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    selector?: string;
    title?: string;
    windowId?: string;
    output?: string;
    format: string;
    maxWidth?: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const formatResult = ImageFormatSchema.safeParse(opts.format);
    if (!formatResult.success) {
      throw new Error(`Invalid format: ${opts.format}. Must be one of: ${ImageFormatSchema.options.join(', ')}`);
    }
    const format = formatResult.data;
    if (!opts.selector && !opts.title && !opts.windowId) {
      throw new Error('Either --selector (with bridge), --title, or --window-id is required');
    }
    const adapter = await getAdapter(opts.selector || opts.maxWidth || format === 'jpg' ? 'image' : 'capture');

    let buffer: Buffer;
    let windowId: string;

    if (opts.selector) {
      // DOM-targeted pixel capture — the core feature
      const bridge = await resolveBridge(opts);
      const elementRect = await bridge.getElementRect(opts.selector);
      if (!elementRect) {
        throw new Error(`Element not found: ${opts.selector}`);
      }

      const viewport = await bridge.getViewportSize();

      windowId = await resolveWindowId(adapter, bridge, opts);
      const windowGeom = await adapter.getWindowGeometry(windowId);

      // Capture full window
      buffer = await adapter.captureWindow(windowId, format);

      // Crop to element
      const cropRect = computeCropRect(elementRect, viewport, {
        width: windowGeom.width,
        height: windowGeom.height,
      });
      buffer = await cropImage(buffer, cropRect, format);
    } else {
      // Full window fallback — no bridge needed
      if (opts.windowId) {
        windowId = opts.windowId;
      } else if (opts.title) {
        windowId = await adapter.findWindow(opts.title);
      } else {
        throw new Error('Either --selector (with bridge), --title, or --window-id is required');
      }
      buffer = await adapter.captureWindow(windowId, format);
    }

    if (opts.maxWidth) {
      buffer = await resizeImage(buffer, opts.maxWidth, format);
    }

    const output = opts.output ?? autoOutputPath(format);
    await writeFile(output, buffer);

    if (opts.json) {
      console.log(JSON.stringify({
        path: output,
        format,
        size: buffer.length,
        selector: opts.selector ?? null,
        windowTitle: opts.title ?? null,
        windowId,
      }, null, 2));
    } else {
      console.log(output);
    }
  });

  program.addCommand(cmd);
}
