import { Command } from 'commander';
import { resolveBridge, parseNonNegativeInt } from '../shared.js';
import type { BridgeClient } from '../../bridge/client.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { evaluateExpression } from '../../bridge/evaluate.js';
import { pollUntil } from '../../util/poll.js';
import { CliError } from '../../util/errors.js';
import { ClickResultSchema } from '../../schemas/interact.js';

export function buildClickScript(
  selector: string,
  opts: { double: boolean; right: boolean },
): string {
  const escaped = escapeSelector(selector);
  const button = opts.right ? 2 : 0;

  return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found' });
  var r = el.getBoundingClientRect();
  var clientX = r.left + r.width / 2;
  var clientY = r.top + r.height / 2;
  var eventOpts = { bubbles: true, cancelable: true, clientX: clientX, clientY: clientY, button: ${button} };
  el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
  el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
  ${opts.right
    ? `el.dispatchEvent(new MouseEvent('contextmenu', eventOpts));`
    : opts.double
      ? `el.dispatchEvent(new MouseEvent('click', eventOpts));
  el.dispatchEvent(new MouseEvent('dblclick', eventOpts));`
      : `el.dispatchEvent(new MouseEvent('click', eventOpts));`}
  var text = (el.textContent || '').trim().slice(0, 100);
  return JSON.stringify({ success: true, selector: '${escaped}', tagName: el.tagName.toLowerCase(), text: text });
})()`;
}

export function registerClick(program: Command): void {
  const cmd = new Command('click')
    .description('Dispatch mouse click events on a DOM element')
    .argument('<selector>', 'CSS selector of the element to click')
    .option('--double', 'Dispatch a double-click (dblclick) instead of a single click')
    .option('--right', 'Dispatch a right-click (contextmenu) instead of a left click')
    .option('--wait <ms>', 'Wait up to <ms> milliseconds for element to appear', parseNonNegativeInt, 0)
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools click "button.submit"
  $ tauri-agent-tools click "#menu-toggle" --double
  $ tauri-agent-tools click ".context-target" --right
  $ tauri-agent-tools click ".lazy-item" --wait 3000 --json`);

  addInteractOptions(cmd);

  cmd.action(async (selector: string, opts: {
    double?: boolean;
    right?: boolean;
    wait: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    if (opts.double && opts.right) throw new CliError('INVALID_ARGUMENT', '--double and --right cannot be combined', 'Choose one click type.');
    const bridge: BridgeClient = await resolveBridge(opts);

    const clickOpts = { double: !!opts.double, right: !!opts.right };
    if (opts.wait > 0) {
      await pollUntil(async remaining => {
        const result = await evaluateExpression(bridge,
          `document.querySelector(${JSON.stringify(selector)}) !== null`, Math.min(5000, remaining));
        return result.truthy ? true : null;
      }, opts.wait, 100, `Timed out waiting for element: ${selector}`);
    }
    const script = buildClickScript(selector, clickOpts);

    const raw = await bridge.eval(script);
    const result = ClickResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(`Click failed: ${result.error} (selector: ${result.selector})`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const actionLabel = opts.right ? 'right-clicked' : opts.double ? 'double-clicked' : 'clicked';
      const textHint = result.text ? ` "${result.text.slice(0, 40)}"` : '';
      console.log(`${actionLabel} <${result.tagName}${textHint}> (${result.selector})`);
    }
  });

  program.addCommand(cmd);
}
