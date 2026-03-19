import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import type { ImageFormat, PlatformAdapter } from '../types.js';
import { ImageFormatSchema } from '../schemas/commands.js';
import { addBridgeOptions, resolveBridge } from './shared.js';
import { computeCropRect, cropImage, resizeImage } from '../util/image.js';

function autoOutputPath(format: ImageFormat): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `screenshot-${ts}.${format}`;
}

export function registerScreenshot(
  program: Command,
  getAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
): void {
  const cmd = new Command('screenshot')
    .description('Capture a screenshot of a window or DOM element')
    .option('-s, --selector <css>', 'CSS selector — screenshot just this element (requires bridge)')
    .option('-t, --title <regex>', 'Window title to match (default: auto-discover from bridge)')
    .option('-o, --output <path>', 'Output file path (default: auto-named)')
    .option('--format <fmt>', 'Output format: png or jpg', 'png')
    .option('--max-width <number>', 'Resize to max width', parseInt)
    .option('--json', 'Output structured JSON metadata');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    selector?: string;
    title?: string;
    output?: string;
    format: string;
    maxWidth?: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const format = ImageFormatSchema.catch('png').parse(opts.format);
    const adapter = await getAdapter();

    let buffer: Buffer;

    if (opts.selector) {
      // DOM-targeted pixel capture — the core feature
      const bridge = await resolveBridge(opts);
      const elementRect = await bridge.getElementRect(opts.selector);
      if (!elementRect) {
        throw new Error(`Element not found: ${opts.selector}`);
      }

      const viewport = await bridge.getViewportSize();

      // Find window
      let windowId: string;
      if (opts.title) {
        windowId = await adapter.findWindow(opts.title);
      } else {
        const title = await bridge.getDocumentTitle();
        if (!title) {
          throw new Error('Could not get window title from bridge. Use --title to specify.');
        }
        windowId = await adapter.findWindow(title);
      }

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
      if (!opts.title) {
        throw new Error('Either --selector (with bridge) or --title is required');
      }
      const windowId = await adapter.findWindow(opts.title);
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
      }, null, 2));
    } else {
      console.log(output);
    }
  });

  program.addCommand(cmd);
}
