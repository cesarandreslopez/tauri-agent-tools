import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from './shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { SelectResultSchema } from '../../schemas/interact.js';

export function buildSelectScript(selector: string, value?: string, toggle: boolean = false): string {
  const escaped = escapeSelector(selector);

  if (toggle) {
    return `(function() {
  try {
    var el = document.querySelector('${escaped}');
    if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ success: true, selector: '${escaped}', tagName: el.tagName.toLowerCase(), checked: el.checked });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
  }

  const escapedValue = value !== undefined ? escapeSelector(value) : '';
  return `(function() {
  try {
    var el = document.querySelector('${escaped}');
    if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
    el.value = '${escapedValue}';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ success: true, selector: '${escaped}', tagName: el.tagName.toLowerCase(), value: el.value });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
}

export function registerSelect(program: Command): void {
  const cmd = new Command('select')
    .description('Set the value of a form element or toggle a checkbox')
    .argument('<selector>', 'CSS selector of the element')
    .argument('[value]', 'Value to set (for inputs, selects)')
    .option('--toggle', 'Toggle the checked state of a checkbox or radio')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools select "select#country" "US"
  $ tauri-agent-tools select "input[name='agree']" --toggle
  $ tauri-agent-tools select "input#search" "hello world"`);

  addInteractOptions(cmd);

  cmd.action(async (selector: string, value: string | undefined, opts: BridgeOpts & { toggle?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const script = buildSelectScript(selector, value, opts.toggle ?? false);
    const raw = await bridge.eval(script);
    const result = SelectResultSchema.parse(JSON.parse(String(raw)));
    if (!result.success) {
      throw new Error(result.error ?? 'Select failed');
    }
    console.log(JSON.stringify(result, null, 2));
  });

  program.addCommand(cmd);
}
