import type { Command } from 'commander';
import type { z } from 'zod';
import { addBridgeOptions, parseIntArg } from '../shared.js';

/**
 * Escapes backslashes and single quotes in CSS selectors for safe
 * embedding inside JS string literals wrapped in single quotes.
 */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Builds a JS snippet that finds an element via querySelector and returns
 * JSON `{ found: true, tagName, id, text }` or `{ found: false }`.
 * Text content is truncated to 100 characters.
 */
export function buildFindElementScript(selector: string): string {
  const escaped = escapeSelector(selector);
  return [
    `(() => {`,
    `  const el = document.querySelector('${escaped}');`,
    `  if (!el) return JSON.stringify({ found: false });`,
    `  const text = (el.textContent || '').trim().slice(0, 100);`,
    `  return JSON.stringify({ found: true, tagName: el.tagName.toLowerCase(), id: el.id || undefined, text: text || undefined });`,
    `})()`,
  ].join('\n');
}

/**
 * When waitMs > 0, builds a JS snippet that polls every 100ms up to the
 * deadline for the element to appear, returning the same JSON shape as
 * buildFindElementScript. When waitMs <= 0, delegates to buildFindElementScript.
 */
export function buildWaitAndFindScript(selector: string, waitMs: number): string {
  if (waitMs <= 0) {
    return buildFindElementScript(selector);
  }

  const escaped = escapeSelector(selector);
  return [
    `new Promise((resolve) => {`,
    `  const deadline = Date.now() + ${waitMs};`,
    `  function poll() {`,
    `    const el = document.querySelector('${escaped}');`,
    `    if (el) {`,
    `      const text = (el.textContent || '').trim().slice(0, 100);`,
    `      resolve(JSON.stringify({ found: true, tagName: el.tagName.toLowerCase(), id: el.id || undefined, text: text || undefined }));`,
    `      return;`,
    `    }`,
    `    if (Date.now() >= deadline) {`,
    `      resolve(JSON.stringify({ found: false }));`,
    `      return;`,
    `    }`,
    `    setTimeout(poll, 100);`,
    `  }`,
    `  poll();`,
    `})`,
  ].join('\n');
}

/**
 * Adds shared interaction options to a command: bridge options (--port, --token)
 * plus --json for machine-readable output. Returns the command for chaining.
 */
export function addInteractOptions(cmd: Command): Command {
  return addBridgeOptions(cmd).option('--json', 'Output result as JSON');
}

// === Value writing + verification (type, select) ===

/**
 * Default deadline for the post-write re-read. An accepted write resolves on
 * the first (synchronous) check, so it costs nothing; only a rejected write
 * waits out the whole deadline.
 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 500;
/**
 * dev_bridge.rs answers 504 after 5 s and BridgeClient.eval aborts at 5 s;
 * keep at least 1 s of slack for dispatch + IPC + HTTP.
 */
export const MAX_VERIFY_TIMEOUT_MS = 4000;
/**
 * Poll cadence after the synchronous first check. React commits
 * transition-lane updates on a Scheduler macrotask, so a microtask/rAF
 * re-read would be too early.
 */
export const VERIFY_INTERVAL_MS = 50;

export interface VerifyOptions {
  /** 0..MAX_VERIFY_TIMEOUT_MS; 0 = single synchronous check. Default DEFAULT_VERIFY_TIMEOUT_MS. */
  verifyTimeoutMs?: number;
}

export function resolveVerifyTimeout(opts?: VerifyOptions): number {
  const ms = opts?.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_VERIFY_TIMEOUT_MS) {
    throw new Error(
      `--verify-timeout must be an integer between 0 and ${MAX_VERIFY_TIMEOUT_MS} ms (the bridge aborts evals after 5000 ms)`,
    );
  }
  return ms;
}

/** Adds --verify-timeout to a value-writing interaction command. */
export function addVerifyOptions(cmd: Command): Command {
  return cmd.option(
    '--verify-timeout <ms>',
    `Max time to wait for the written value to stick before reporting it reverted (max ${MAX_VERIFY_TIMEOUT_MS}, 0 = single check)`,
    parseIntArg,
    DEFAULT_VERIFY_TIMEOUT_MS,
  );
}

/**
 * JS snippet defining `__resolveValueWriter(node)`.
 *
 * React (react-dom's inputValueTracking) redefines `value` as an own accessor
 * on every mounted <input>/<textarea> instance to remember what it wrote;
 * assigning through that accessor makes the following input/change event a
 * no-op for React (#10). Built-in form elements are therefore written through
 * the prototype setter React itself captured. Custom elements are searched up
 * their prototype chain (Lit/Stencil define accessors on the class prototype)
 * and fall back to plain assignment for instance-defined or class-field
 * `value`s. Anything else has no value setter and is refused instead of being
 * silently given an expando property.
 *
 * The parameter is deliberately named `node` so generated scripts never
 * contain the text `el.value =`.
 */
export const NATIVE_VALUE_WRITER_SNIPPET = `
  function __resolveValueWriter(node) {
    var tag = node.tagName;
    var proto = tag === 'INPUT' ? HTMLInputElement.prototype
      : tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : tag === 'SELECT' ? HTMLSelectElement.prototype
      : null;
    if (proto) {
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && typeof d.set === 'function') return { kind: 'native', set: function (v) { d.set.call(node, v); } };
      return { kind: 'assign', set: function (v) { node.value = v; } };
    }
    if (String(node.localName || '').indexOf('-') !== -1) {
      var p = Object.getPrototypeOf(node);
      while (p && p !== Object.prototype) {
        var cd = Object.getOwnPropertyDescriptor(p, 'value');
        if (cd && typeof cd.set === 'function') return { kind: 'custom', set: function (v) { cd.set.call(node, v); } };
        p = Object.getPrototypeOf(p);
      }
      if ('value' in node) return { kind: 'assign', set: function (v) { node.value = v; } };
    }
    return null;
  }`;

/**
 * JS snippet defining `__verify(read, expected, timeoutMs, intervalMs)`.
 *
 * The first read is synchronous: React restores a rejected controlled value
 * inside dispatchEvent, so it is already visible. Later reads catch
 * transition-lane commits and frameworks that apply values asynchronously.
 * Resolves `{ ok, observed }` and never rejects. `read` is re-invoked on every
 * tick so a re-mounted node is read instead of a stale reference.
 */
export const VERIFY_POLL_SNIPPET = `
  function __verify(read, expected, timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + timeoutMs;
      function check() {
        var observed;
        try { observed = read(); } catch (e) { observed = undefined; }
        if (observed === expected) { resolve({ ok: true, observed: observed }); return; }
        if (Date.now() >= deadline) { resolve({ ok: false, observed: observed }); return; }
        setTimeout(check, intervalMs);
      }
      check();
    });
  }`;

/**
 * JS snippet defining `__settle()` — resolves after two macrotasks. Used after
 * focus()/--clear so that state the app changed in response (React flushes an
 * onFocus setState on a microtask, an accepted clear commits synchronously, and
 * a commit scheduled from the app's own zero-delay timer lands on a Scheduler
 * task after the first macrotask) is visible before the pre-write baseline is
 * read and the target node is re-resolved.
 */
export const SETTLE_SNIPPET = `
  function __settle() {
    return new Promise(function (resolve) {
      setTimeout(function () { setTimeout(resolve, 0); }, 0);
    });
  }`;

/** JS snippet defining `__selectOptionValues(node)` — option values of a <select>, [] otherwise. */
export const SELECT_OPTIONS_SNIPPET = `
  function __selectOptionValues(node) {
    if (!node.options || typeof node.options.length !== 'number') return [];
    return Array.prototype.map.call(node.options, function (o) { return String(o.value); });
  }`;

export interface SetValueScriptOptions {
  /** `type` focuses the element first; `select` does not. */
  focus: boolean;
  /** `type --clear`: select() + write '' + input event before the real write. */
  clear: boolean;
  /** Existing contracts differ: `type` reports el.tagName as-is, `select` lower-cases it. */
  lowerCaseTagName: boolean;
  /** JS expression for the not-found error; `selector` is in scope. */
  notFoundErrorExpr: string;
  verifyTimeoutMs: number;
}

/**
 * Shared script body for `type` and `select` value mode. Returns an arrow IIFE
 * that resolves (via a Promise — the bridge awaits it) to a JSON string and
 * never throws into the bridge.
 *
 * Sequence: snapshot `previousValue` → [focus] → [clear + input] → settle →
 * re-resolve the target (the app may have re-mounted it) → snapshot `baseline`
 * → native write → `applied` → refuse values the browser discarded or clamped
 * back → input, change → verify. `reverted` means the re-read equals
 * `baseline` or `previousValue`; comparing only against the pre-command value
 * would let an app that accepted the clear (or changed the value on focus) but
 * rejected the real write pass as `transformed`. A field the app empties after
 * a non-empty write is a failure too ("cleared"): the intended value did not
 * land whether the app rejected or consumed it.
 */
export function buildSetValueScript(selector: string, value: string, o: SetValueScriptOptions): string {
  const escapedSelector = escapeSelector(selector);
  const safeValue = JSON.stringify(value);
  const tagExpr = o.lowerCaseTagName ? 'el.tagName.toLowerCase()' : 'el.tagName';
  const focusBlock = o.focus
    ? `
    if (typeof el.focus === 'function') el.focus();`
    : '';
  const clearBlock = o.clear
    ? `
    if (typeof el.select === 'function') el.select();
    writer.set('');
    el.dispatchEvent(new Event('input', { bubbles: true }));`
    : '';

  return `(() => {${NATIVE_VALUE_WRITER_SNIPPET}${VERIFY_POLL_SNIPPET}${SETTLE_SNIPPET}${SELECT_OPTIONS_SNIPPET}
  var selector = '${escapedSelector}';
  var requested = ${safeValue};
  var clearRan = ${o.clear ? 'true' : 'false'};
  var fail = function (extra) { return JSON.stringify(Object.assign({ success: false, selector: selector }, extra)); };
  function describe(node) {
    var t = node.tagName.toLowerCase();
    var it = t === 'input' ? String(node.type || 'text').toLowerCase() : '';
    return '<' + t + (it ? ' type=' + it : '') + '>';
  }
  function unsupported(node) {
    return { error: 'Unsupported element ' + describe(node) + ': no value setter', hint: 'Supported: <input>, <textarea>, <select>, and custom elements that expose a value property. For contenteditable regions use \`eval\`.' };
  }
  try {
    var el = document.querySelector(selector);
    if (!el) return fail({ error: ${o.notFoundErrorExpr} });
    var tagName = ${tagExpr};
    var inputType = el.tagName === 'INPUT' ? String(el.type || 'text').toLowerCase() : '';
    if (inputType === 'checkbox' || inputType === 'radio') {
      return fail({ tagName: tagName, error: 'Cannot set a text value on <input type=' + inputType + '>', hint: 'Use \`select <selector> --toggle\` to change its checked state.' });
    }
    if (inputType === 'file') {
      return fail({ tagName: tagName, error: 'Cannot set the value of <input type=file>: browsers reject scripted file values' });
    }
    var writer = __resolveValueWriter(el);
    if (!writer) return fail(Object.assign({ tagName: tagName }, unsupported(el)));
    if (el.tagName === 'SELECT') {
      var options = __selectOptionValues(el);
      if (options.indexOf(requested) === -1) {
        return fail({ tagName: tagName, requestedValue: requested, options: options.slice(0, 50), error: 'No <option> with value ' + JSON.stringify(requested), hint: 'Pass the option value attribute, not its label. Available values: ' + options.slice(0, 20).join(', ') });
      }
    }
    var previousValue = String(el.value);${focusBlock}${clearBlock}
    var base = { selector: selector, tagName: tagName, requestedValue: requested, previousValue: previousValue };
    return __settle().then(function () {
      var live = document.querySelector(selector);
      if (!live) {
        return fail(Object.assign({ error: 'Element left the document after focus/clear (removed or re-rendered without a matching selector); nothing was written', hint: 'The app re-rendered in response to focus or the clear. Re-query the DOM and retry, or target a stable selector.' }, base));
      }
      if (live !== el) {
        el = live;
        writer = __resolveValueWriter(el);
        if (!writer) return fail(Object.assign({}, base, unsupported(el)));
      }
      var baseline = String(el.value);
      writer.set(requested);
      var applied = String(el.value);
      if (writer.kind === 'native' && requested !== '' && applied === '') {
        // Undo our own writes only: after --clear that is the pre-clear value;
        // otherwise the value the field held right before the write (which an
        // app may have changed on focus).
        var restored = clearRan ? previousValue : baseline;
        writer.set(restored);
        if (clearRan) el.dispatchEvent(new Event('input', { bubbles: true }));
        return fail(Object.assign({
          value: restored,
          error: 'Browser discarded the value: ' + describe(el) + ' sanitized ' + JSON.stringify(requested) + ' to ""',
          hint: 'Use a value the control accepts (e.g. digits for type=number, YYYY-MM-DD for type=date). The previous value was restored' + (clearRan ? ' (the field had already been cleared, so an input event was dispatched for the restore).' : ' and no events were dispatched.')
        }, base));
      }
      if (writer.kind === 'native' && requested !== baseline && applied === baseline) {
        return fail(Object.assign({
          value: baseline,
          error: 'Browser did not take the value: ' + describe(el) + ' still reads ' + JSON.stringify(baseline) + ' after writing ' + JSON.stringify(requested),
          hint: 'The control clamped or sanitized the value back onto its current value (e.g. min/max on type=range, the format of type=color). No events were dispatched.'
        }, base));
      }
      // Built-in controls may legitimately normalize the value (newlines stripped, numbers canonicalized): verify against what the setter kept. Custom elements may reflect asynchronously: verify against the request.
      var expected = writer.kind === 'native' ? applied : requested;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      (document.querySelector(selector) || el).dispatchEvent(new Event('change', { bubbles: true }));
      return __verify(function () {
        var cur = document.querySelector(selector) || (el.isConnected ? el : null);
        return cur ? String(cur.value) : null;
      }, expected, ${o.verifyTimeoutMs}, ${VERIFY_INTERVAL_MS}).then(function (v) {
        if (v.ok) {
          return JSON.stringify(Object.assign({ success: true, value: v.observed, verified: true, verification: 'matched' }, base));
        }
        if (v.observed === null) {
          return fail(Object.assign({ value: applied, verified: false, error: 'Element left the document after the write; the value could not be verified', hint: 'The app removed or re-rendered the element without a matching selector after the input/change events (navigation, a remount). Re-query the DOM to confirm the app state.' }, base));
        }
        var observed = v.observed === undefined ? '' : v.observed;
        if (observed === baseline || observed === previousValue) {
          return fail(Object.assign({
            value: observed, verified: false, verification: 'reverted',
            error: 'Value reverted: wrote ' + JSON.stringify(applied) + ' but the element reads ' + JSON.stringify(observed) + ' again after ${o.verifyTimeoutMs}ms',
            hint: 'The app restored the previous value: a controlled input whose change handler did not accept the write (app-side validation), or one that normalized it to the value already present. Check the app state binding; if the app applies values asynchronously, raise --verify-timeout.'
          }, base));
        }
        if (requested !== '' && observed === '') {
          return fail(Object.assign({
            value: observed, verified: false, verification: 'reverted',
            error: 'Value cleared: wrote ' + JSON.stringify(applied) + ' but the element is empty after ${o.verifyTimeoutMs}ms',
            hint: 'The app emptied the field after the write: it rejected the value (validation reset) or consumed it (e.g. a tag/chip input). Check the app state to tell which.'
          }, base));
        }
        return JSON.stringify(Object.assign({ success: true, value: observed, verified: false, verification: 'transformed' }, base));
      });
    }).catch(function (e) {
      return fail({ error: 'Script error: ' + (e && e.message ? e.message : String(e)) });
    });
  } catch (e) {
    return fail({ error: 'Script error: ' + (e && e.message ? e.message : String(e)) });
  }
})()`;
}

/**
 * Parses an interaction result from the bridge. dev_bridge.rs turns a thrown
 * script into the string "ERROR: <message>", which JSON.parse would reject
 * with an opaque SyntaxError — surface it as an actionable error instead.
 */
export function parseInteractResult<S extends z.ZodTypeAny>(raw: unknown, schema: S, command: string): z.infer<S> {
  const text = String(raw ?? '');
  if (text.startsWith('ERROR: ')) {
    throw new Error(`${command} failed: the bridge script threw: ${text.slice('ERROR: '.length)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${command} failed: bridge returned a non-JSON result: ${text.slice(0, 200)}`);
  }
  return schema.parse(parsed);
}
