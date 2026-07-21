import { Command } from 'commander';
import type { PlatformAdapter } from '../types.js';
import { detectDisplayServer } from '../platform/detect.js';

export function registerInfo(
  program: Command,
  getAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
): void {
  const cmd = new Command('info')
    .description('Show window geometry and display server info')
    .option('-t, --title <regex>', 'Window title to match — regex; quote titles with spaces')
    .option('-w, --window-id <id>', 'Platform window id (from list-windows) — overrides --title')
    .option('--json', 'Output as JSON')
    .action(async (opts: { title?: string; windowId?: string; json?: boolean }) => {
      const adapter = await getAdapter();
      let windowId: string;
      if (opts.windowId) {
        windowId = opts.windowId;
      } else if (opts.title) {
        windowId = await adapter.findWindow(opts.title);
      } else {
        throw new Error('Either --title or --window-id is required');
      }
      const geom = await adapter.getWindowGeometry(windowId);
      const name = await adapter.getWindowName(windowId);
      const displayServer = detectDisplayServer();

      const info = { ...geom, name, displayServer };

      if (opts.json) {
        console.log(JSON.stringify(info, null, 2));
      } else {
        console.log(`Window ID:      ${info.windowId}`);
        console.log(`Name:           ${info.name}`);
        console.log(`Position:       ${info.x}, ${info.y}`);
        console.log(`Size:           ${info.width}x${info.height}`);
        console.log(`Display Server: ${info.displayServer}`);
      }
    });

  program.addCommand(cmd);
}
