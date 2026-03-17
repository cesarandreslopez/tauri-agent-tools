import { Command } from 'commander';
import type { PlatformAdapter } from '../types.js';
import { addBridgeOptions, resolveBridge } from './shared.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerWait(
  program: Command,
  getAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
): void {
  const cmd = new Command('wait')
    .description('Wait for a condition to be met')
    .option('-s, --selector <css>', 'Wait for CSS selector to match an element')
    .option('-e, --eval <js>', 'Wait for JS expression to be truthy')
    .option('-t, --title <regex>', 'Wait for window with title (no bridge needed)')
    .option('--timeout <ms>', 'Maximum wait time in milliseconds', parseInt, 10000)
    .option('--interval <ms>', 'Polling interval in milliseconds', parseInt, 500);

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    selector?: string;
    eval?: string;
    title?: string;
    timeout: number;
    interval: number;
    port?: number;
    token?: string;
  }) => {
    if (!opts.selector && !opts.eval && !opts.title) {
      throw new Error('One of --selector, --eval, or --title is required');
    }

    const deadline = Date.now() + opts.timeout;

    if (opts.title) {
      // No bridge needed — poll platform adapter
      const adapter = await getAdapter();
      while (Date.now() < deadline) {
        try {
          const windowId = await adapter.findWindow(opts.title);
          console.log(windowId);
          return;
        } catch {
          await sleep(opts.interval);
        }
      }
      throw new Error(`Timed out waiting for window: ${opts.title}`);
    }

    // Bridge-dependent modes
    const bridge = await resolveBridge(opts);

    if (opts.selector) {
      const escaped = opts.selector.replace(/'/g, "\\'");
      while (Date.now() < deadline) {
        const result = await bridge.eval(
          `document.querySelector('${escaped}') !== null`,
        );
        if (result === true) {
          console.log('found');
          return;
        }
        await sleep(opts.interval);
      }
      throw new Error(`Timed out waiting for selector: ${opts.selector}`);
    }

    if (opts.eval) {
      while (Date.now() < deadline) {
        const result = await bridge.eval(opts.eval);
        if (result) {
          console.log(JSON.stringify(result));
          return;
        }
        await sleep(opts.interval);
      }
      throw new Error(`Timed out waiting for expression to be truthy`);
    }
  });

  program.addCommand(cmd);
}
