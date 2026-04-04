import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { TypeResultSchema } from '../../schemas/interact.js';

/**
 * Build a JS IIFE script that types text into the element matched by selector.
 */
export function buildTypeScript(selector: string, text: string, clear: boolean): string {
  const escapedSelector = escapeSelector(selector);
  const safeText = JSON.stringify(text);

  const clearBlock = clear
    ? `
    el.focus();
    el.select();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));`
    : '';

  return `(() => {
  var el = document.querySelector('${escapedSelector}');
  if (!el) {
    return JSON.stringify({ success: false, selector: '${escapedSelector}', error: 'Element not found' });
  }
  el.focus();${clearBlock}
  el.value = ${safeText};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ success: true, selector: '${escapedSelector}', tagName: el.tagName, value: el.value });
})()`;
}

export function registerType(program: Command): void {
  const cmd = new Command('type')
    .description('Type text into an input element in the Tauri app')
    .argument('<selector>', 'CSS selector for the input element')
    .argument('<text>', 'Text to type into the element')
    .option('--clear', 'Clear the field before typing')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools type "#username" "admin"
  $ tauri-agent-tools type "input[name=email]" "user@example.com" --clear
  $ tauri-agent-tools type ".search-input" "hello world" --json`);

  addInteractOptions(cmd);

  cmd.action(async (selector: string, text: string, opts: BridgeOpts & { clear?: boolean; json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const script = buildTypeScript(selector, text, !!opts.clear);
    const raw = await bridge.eval(script);
    const result = TypeResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(`Type failed: ${result.error} (selector: ${result.selector})`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Typed into ${(result.tagName ?? 'element').toLowerCase()}: "${result.value}"`);
    }
  });

  program.addCommand(cmd);
}
