import { Command } from 'commander';
import type { AdapterFactory } from '../types.js';
import { addBridgeOptions, resolveBridge, parsePositiveInt, type BridgeOpts } from './shared.js';
import { evaluateExpression } from '../bridge/evaluate.js';
import { pollUntil } from '../util/poll.js';
import { CliError } from '../errors.js';

export function registerWait(
  program: Command,
  getAdapter: AdapterFactory,
): void {
  const cmd = new Command('wait')
    .description('Wait for a condition to be met')
    .option('-s, --selector <css>', 'Wait for CSS selector to match an element')
    .option('-e, --eval <js>', 'Wait for JS expression to be truthy')
    .option('-t, --title <pattern>', 'Wait for title (X11: regex; macOS/Wayland: substring); quote titles with spaces (no bridge needed)')
    .option('--timeout <ms>', 'Maximum wait time in milliseconds', parsePositiveInt, 10000)
    .option('--interval <ms>', 'Polling interval in milliseconds', parsePositiveInt, 500)
    .option('--json', 'Output structured JSON result')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools wait --title "My App" --timeout 5000
  $ tauri-agent-tools wait --selector ".loaded" --json
  $ tauri-agent-tools wait --eval "window.appReady === true"`);

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & {
    selector?: string;
    eval?: string;
    title?: string;
    timeout: number;
    interval: number;
    json?: boolean;
  }) => {
    const modes = [opts.selector, opts.eval, opts.title].filter(v => v !== undefined);
    if (modes.length !== 1) {
      throw new CliError('INVALID_ARGUMENT', 'One of --selector, --eval, or --title is required (choose exactly one)', 'Use wait --help for examples.');
    }
    const start = Date.now();
    if (opts.title !== undefined) {
      const adapter = await getAdapter();
      const windowId = await pollUntil(async () => {
        try { return await adapter.findWindow(opts.title!); }
        catch (error) {
          if (error instanceof Error && /No window|not found/i.test(error.message)) return null;
          throw error;
        }
      }, opts.timeout, opts.interval, `Timed out waiting for window: ${opts.title}`);
      console.log(opts.json
        ? JSON.stringify({ matched: true, mode: 'title', windowId, elapsed: Date.now() - start })
        : windowId);
      return;
    }
    const bridge = await resolveBridge(opts);
    const selectorMode = opts.selector !== undefined;
    const expression = selectorMode
      ? `document.querySelector(${JSON.stringify(opts.selector)}) !== null`
      : opts.eval!;
    const result = await pollUntil(async remaining => {
      const evaluated = await evaluateExpression(bridge, expression, Math.min(5000, remaining));
      return evaluated.truthy ? evaluated : null;
    }, opts.timeout, opts.interval, selectorMode
      ? `Timed out waiting for selector: ${opts.selector}`
      : 'Timed out waiting for expression to be truthy');
    // Preserve the historical bridge-serialized result field for eval mode.
    const value = result.value === null || typeof result.value === 'string'
      ? result.value
      : typeof result.value === 'object' ? JSON.stringify(result.value) : String(result.value);
    if (opts.json) {
      console.log(JSON.stringify(selectorMode
        ? { matched: true, mode: 'selector', selector: opts.selector, elapsed: Date.now() - start }
        : { matched: true, mode: 'eval', result: value, elapsed: Date.now() - start }));
    } else {
      console.log(selectorMode ? 'found' : JSON.stringify(value));
    }
  });

  program.addCommand(cmd);
}
