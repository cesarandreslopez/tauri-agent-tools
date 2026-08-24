import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import {
  addInteractOptions,
  addVerifyOptions,
  buildSetValueScript,
  escapeSelector,
  parseInteractResult,
  resolveVerifyTimeout,
  VERIFY_INTERVAL_MS,
  VERIFY_POLL_SNIPPET,
} from './shared.js';
import type { VerifyOptions } from './shared.js';
import { SelectResultSchema } from '../../schemas/interact.js';

/**
 * --toggle: a native click(). The browser flips checkedness internally (not
 * through the JS `checked` setter React wraps), fires input + change, honours
 * preventDefault(), and is the only event React's ChangeEventPlugin observes
 * for checkbox/radio. click() is a no-op on disabled controls (including
 * descendants of <fieldset disabled>) and cannot uncheck a radio, so those
 * are refused up front instead of reporting a state that did not change.
 */
function buildToggleScript(selector: string, verifyTimeoutMs: number): string {
  const escaped = escapeSelector(selector);
  return `(() => {${VERIFY_POLL_SNIPPET}
  var selector = '${escaped}';
  var fail = function (extra) { return JSON.stringify(Object.assign({ success: false, selector: selector }, extra)); };
  function isDisabled(node) {
    try { if (node.matches(':disabled')) return true; } catch (e) { /* selector unsupported */ }
    if (node.disabled) return true;
    return !!(typeof node.closest === 'function' && node.closest('fieldset[disabled]'));
  }
  try {
    var el = document.querySelector(selector);
    if (!el) return fail({ error: 'Element not found: ' + selector });
    var tagName = el.tagName.toLowerCase();
    var inputType = tagName === 'input' ? String(el.type || 'text').toLowerCase() : '';
    if (inputType !== 'checkbox' && inputType !== 'radio') {
      return fail({ tagName: tagName, error: 'Element <' + tagName + (inputType ? ' type=' + inputType : '') + '> is not a checkbox or radio', hint: '--toggle supports <input type=checkbox|radio>; use \`select <selector> <value>\` for other elements.' });
    }
    var before = !!el.checked;
    if (isDisabled(el)) {
      return fail({ tagName: tagName, checked: before, error: 'Element is disabled (or inside a disabled <fieldset>); click() has no effect' });
    }
    if (inputType === 'radio' && before) {
      return fail({ tagName: tagName, checked: true, error: 'Radio input is already checked; a radio cannot be unchecked by clicking it', hint: 'Toggle the sibling radio you want selected instead.' });
    }
    var expected = !before;
    el.click();
    return __verify(function () {
      var cur = document.querySelector(selector) || el;
      return !!cur.checked;
    }, expected, ${verifyTimeoutMs}, ${VERIFY_INTERVAL_MS}).then(function (v) {
      if (v.ok) {
        return JSON.stringify({ success: true, selector: selector, tagName: tagName, checked: v.observed, previousChecked: before, verified: true, verification: 'matched' });
      }
      return fail({
        tagName: tagName, checked: !!v.observed, previousChecked: before, verified: false, verification: 'reverted',
        error: 'Checked state reverted: click() set checked=' + expected + ' but the element reads ' + String(!!v.observed) + ' after ${verifyTimeoutMs}ms',
        hint: 'A controlled checkbox whose change handler did not accept the change, or a click listener that called preventDefault().'
      });
    });
  } catch (e) {
    return fail({ error: 'Script error: ' + (e && e.message ? e.message : String(e)) });
  }
})()`;
}

/**
 * Value mode writes through the native prototype value setter and verifies the
 * write (see buildSetValueScript); toggle mode performs a native click().
 */
export function buildSelectScript(
  selector: string,
  value?: string,
  toggle: boolean = false,
  options?: VerifyOptions,
): string {
  const verifyTimeoutMs = resolveVerifyTimeout(options);
  if (toggle) return buildToggleScript(selector, verifyTimeoutMs);
  return buildSetValueScript(selector, value ?? '', {
    focus: false,
    clear: false,
    lowerCaseTagName: true,
    notFoundErrorExpr: `'Element not found: ' + selector`,
    verifyTimeoutMs,
  });
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
  $ tauri-agent-tools select "input#search" "hello world"

Values are written through the native prototype setter and followed by bubbling
input + change events; <select> values must match an <option> value attribute.
--toggle performs a native click() so React and other frameworks that listen to
click for checkboxes update their state. The element is re-read afterwards and
the command fails when the app reverted the change.`);

  addInteractOptions(cmd);
  addVerifyOptions(cmd);

  cmd.action(
    async (
      selector: string,
      value: string | undefined,
      opts: BridgeOpts & { toggle?: boolean; verifyTimeout: number },
    ) => {
      // Build first: an invalid --verify-timeout fails before any bridge call.
      const script = buildSelectScript(selector, value, opts.toggle ?? false, { verifyTimeoutMs: opts.verifyTimeout });
      const bridge = await resolveBridge(opts);
      const raw = await bridge.eval(script);
      const result = parseInteractResult(raw, SelectResultSchema, 'Select');
      if (!result.success) {
        const hint = result.hint ? `\n  hint: ${result.hint}` : '';
        throw new Error(`${result.error ?? 'Select failed'}${hint}`);
      }
      console.log(JSON.stringify(result, null, 2));
    },
  );

  program.addCommand(cmd);
}
