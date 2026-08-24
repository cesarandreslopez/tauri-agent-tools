import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import {
  addInteractOptions,
  addVerifyOptions,
  buildSetValueScript,
  parseInteractResult,
  resolveVerifyTimeout,
} from './shared.js';
import type { VerifyOptions } from './shared.js';
import { TypeResultSchema } from '../../schemas/interact.js';

/**
 * Build a JS IIFE that types text into the element matched by selector.
 *
 * Both the --clear write and the final write go through the element's native
 * prototype value setter (see NATIVE_VALUE_WRITER_SNIPPET) so React-style
 * instance trackers see the following input/change events as real changes
 * (#10). The script then re-reads the value (synchronously, then polled up to
 * verifyTimeoutMs) and reports `reverted` when the app restored the previous
 * value. Returns a Promise-resolving IIFE; the bridge awaits it.
 */
export function buildTypeScript(selector: string, text: string, clear: boolean, options?: VerifyOptions): string {
  return buildSetValueScript(selector, text, {
    focus: true,
    clear,
    lowerCaseTagName: false,
    notFoundErrorExpr: `'Element not found'`,
    verifyTimeoutMs: resolveVerifyTimeout(options),
  });
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
  $ tauri-agent-tools type ".search-input" "hello world" --json
  $ tauri-agent-tools type "#q" "term" --verify-timeout 2000    # app applies the value asynchronously

The value is written through the element's native prototype setter followed by
bubbling input + change events, so React/Vue/Svelte controlled inputs see it.
The element is then re-read; the command fails with "Value reverted" when the
app restored the previous value (a controlled input that rejected the write).`);

  addInteractOptions(cmd);
  addVerifyOptions(cmd);

  cmd.action(
    async (
      selector: string,
      text: string,
      opts: BridgeOpts & { clear?: boolean; json?: boolean; verifyTimeout: number },
    ) => {
      // Build first: an invalid --verify-timeout fails before any bridge call.
      const script = buildTypeScript(selector, text, !!opts.clear, { verifyTimeoutMs: opts.verifyTimeout });
      const bridge = await resolveBridge(opts);
      const raw = await bridge.eval(script);
      const result = parseInteractResult(raw, TypeResultSchema, 'Type');

      if (!result.success) {
        const hint = result.hint ? `\n  hint: ${result.hint}` : '';
        throw new Error(`Type failed: ${result.error} (selector: ${result.selector})${hint}`);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const tag = (result.tagName ?? 'element').toLowerCase();
      let note = '';
      if (result.verification === 'transformed') {
        note = ` (app transformed the requested value ${JSON.stringify(result.requestedValue)})`;
      } else if (result.requestedValue !== undefined && result.value !== result.requestedValue) {
        note = ` (browser normalized the requested value ${JSON.stringify(result.requestedValue)})`;
      }
      console.log(`Typed into ${tag}: "${result.value}"${note}`);
    },
  );

  program.addCommand(cmd);
}
