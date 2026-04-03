import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { InteractionResultSchema } from '../../schemas/interact.js';

export function buildFocusScript(selector: string): string {
  const escaped = escapeSelector(selector);
  return `(function() {
  try {
    var el = document.querySelector('${escaped}');
    if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
    el.focus();
    return JSON.stringify({ success: true, selector: '${escaped}', tagName: el.tagName.toLowerCase() });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
}

export function registerFocus(program: Command): void {
  const cmd = new Command('focus')
    .description('Focus a DOM element by CSS selector')
    .argument('<selector>', 'CSS selector of the element to focus')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools focus "input[name='email']"
  $ tauri-agent-tools focus "#submit-button"
  $ tauri-agent-tools focus ".search-field"`);

  addInteractOptions(cmd);

  cmd.action(async (selector: string, opts: BridgeOpts) => {
    const bridge = await resolveBridge(opts);
    const script = buildFocusScript(selector);
    const raw = await bridge.eval(script);
    const result = InteractionResultSchema.parse(JSON.parse(String(raw)));
    if (!result.success) {
      throw new Error(result.error ?? 'Focus failed');
    }
    console.log(JSON.stringify(result, null, 2));
  });

  program.addCommand(cmd);
}
