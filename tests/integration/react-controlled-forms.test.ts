// @vitest-environment jsdom
/**
 * Regression fixture for #10: `type`/`select` against REAL React controlled
 * elements rendered by react-dom in jsdom.
 *
 * The generated scripts are executed through an emulation of the Rust bridge's
 * eval wrapper (examples/tauri-bridge/src/dev_bridge.rs: indirect `eval`, a
 * returned Promise is awaited, a throw becomes the string "ERROR: <message>").
 *
 * This is the only jsdom-environment test in the repo; every other test file
 * runs in the default node environment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, Fragment, useState, useReducer, startTransition } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { buildTypeScript } from '../../src/commands/interact/type.js';
import { buildSelectScript } from '../../src/commands/interact/select.js';
import { TypeResultSchema, SelectResultSchema } from '../../src/schemas/interact.js';

/** Mirrors dev_bridge.rs build_eval_callback_js: global-scope eval, Promise awaited, throw -> "ERROR: msg". */
async function bridgeEval(js: string): Promise<string | null> {
  try {
    const result: unknown = await (0, eval)(js);
    if (typeof result === 'undefined') return null;
    if (typeof result === 'object' && result !== null) return JSON.stringify(result);
    return typeof result === 'string' ? result : String(result);
  } catch (e) {
    return 'ERROR: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** Short deadline: only reject paths pay it; accepted writes resolve on the first (synchronous) check. */
const VERIFY = { verifyTimeoutMs: 200 };

async function typeViaCli(selector: string, text: string, clear = false, opts = VERIFY) {
  const raw = await bridgeEval(buildTypeScript(selector, text, clear, opts));
  expect(raw).not.toMatch(/^ERROR:/);
  return TypeResultSchema.parse(JSON.parse(String(raw)));
}

async function selectViaCli(selector: string, value?: string, toggle = false, opts = VERIFY) {
  const raw = await bridgeEval(buildSelectScript(selector, value, toggle, opts));
  expect(raw).not.toMatch(/^ERROR:/);
  return SelectResultSchema.parse(JSON.parse(String(raw)));
}

// Verbatim output of the pre-fix builders (git show 468e2e1:src/commands/interact/type.ts,
// buildTypeScript('#field', 'sentinel', true)). Negative control: proves the fixture reproduces #10.
const LEGACY_TYPE_SCRIPT = `(() => {
  var el = document.querySelector('#field');
  if (!el) {
    return JSON.stringify({ success: false, selector: '#field', error: 'Element not found' });
  }
  el.focus();
    el.focus();
    el.select();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  el.value = "sentinel";
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ success: true, selector: '#field', tagName: el.tagName, value: el.value });
})()`;

// Verbatim pre-fix buildSelectScript('#cb', undefined, true).
const LEGACY_TOGGLE_SCRIPT = `(function() {
  try {
    var el = document.querySelector('#cb');
    if (!el) return JSON.stringify({ success: false, error: 'Element not found: #cb' });
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ success: true, selector: '#cb', tagName: el.tagName.toLowerCase(), checked: el.checked });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;

interface Handles {
  /** Current React state of the controlled element. */
  state: () => string;
  /** Force a synchronous re-render of the fixture component. */
  rerender: () => void;
  /** Called with the value React's onChange saw. */
  onChange: ReturnType<typeof vi.fn>;
}

const makeHandles = (): Handles => ({ state: () => '', rerender: () => {}, onChange: vi.fn() });

interface FieldProps {
  tag: 'input' | 'textarea';
  /** false = controlled value pinned (onChange ignores the event); a predicate accepts selectively. */
  accept?: boolean | ((v: string) => boolean);
  initial?: string;
  /** Reformats the value when the field receives focus (unformat-on-focus masks). */
  onFocus?: (v: string) => string;
  /** When a write is rejected, reset the state to this value instead of leaving it. */
  resetTo?: string;
  /** Re-mount the element (new key) on focus / on every change. */
  remountOnFocus?: boolean;
  remountOnChange?: boolean;
  /** Maps accepted values (masks/formatters). */
  transform?: (v: string) => string;
  /** Commit the accepted value through startTransition (non-sync lane). */
  transition?: boolean;
  handles: Handles;
}

function ControlledField(p: FieldProps) {
  const [value, setValue] = useState(p.initial ?? '');
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [key, bumpKey] = useReducer((n: number) => n + 1, 0);
  p.handles.state = () => value;
  p.handles.rerender = () => flushSync(() => bump());
  return createElement(
    Fragment,
    null,
    createElement(p.tag, {
      key,
      id: 'field',
      type: p.tag === 'input' ? 'text' : undefined,
      value,
      onFocus: () => {
        if (p.onFocus) setValue(p.onFocus(value));
        if (p.remountOnFocus) bumpKey();
      },
      onChange: (e: { target: { value: string } }) => {
        p.handles.onChange(e.target.value);
        if (p.remountOnChange) bumpKey();
        const accepts = typeof p.accept === 'function' ? p.accept(e.target.value) : p.accept !== false;
        if (!accepts) {
          if (p.resetTo !== undefined) setValue(p.resetTo);
          return;
        }
        const next = p.transform ? p.transform(e.target.value) : e.target.value;
        if (p.transition) startTransition(() => setValue(next));
        else setValue(next);
      },
    }),
    createElement('span', { id: 'mirror' }, value),
  );
}

function ControlledSelect(p: { accept?: boolean; handles: Handles }) {
  const [value, setValue] = useState('CA');
  const [, bump] = useReducer((n: number) => n + 1, 0);
  p.handles.state = () => value;
  p.handles.rerender = () => flushSync(() => bump());
  return createElement(
    Fragment,
    null,
    createElement(
      'select',
      {
        id: 'sel',
        value,
        onChange: (e: { target: { value: string } }) => {
          p.handles.onChange(e.target.value);
          if (p.accept !== false) setValue(e.target.value);
        },
      },
      createElement('option', { value: 'CA' }, 'Canada'),
      createElement('option', { value: 'US' }, 'United States'),
    ),
    createElement('span', { id: 'mirror' }, value),
  );
}

function ControlledCheckbox(p: { accept?: boolean; disabled?: boolean; fieldsetDisabled?: boolean; handles: Handles }) {
  const [checked, setChecked] = useState(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  p.handles.state = () => String(checked);
  p.handles.rerender = () => flushSync(() => bump());
  const input = createElement('input', {
    id: 'cb',
    type: 'checkbox',
    checked,
    disabled: !!p.disabled,
    onChange: (e: { target: { checked: boolean } }) => {
      p.handles.onChange(e.target.checked);
      if (p.accept !== false) setChecked(e.target.checked);
    },
  });
  return createElement(
    Fragment,
    null,
    p.fieldsetDisabled ? createElement('fieldset', { disabled: true }, input) : input,
    createElement('span', { id: 'mirror' }, String(checked)),
  );
}

function ControlledRadios(p: { handles: Handles }) {
  const [v, setV] = useState('a');
  p.handles.state = () => v;
  return createElement(
    Fragment,
    null,
    createElement('input', { id: 'ra', type: 'radio', name: 'r', value: 'a', checked: v === 'a', onChange: () => setV('a') }),
    createElement('input', {
      id: 'rb',
      type: 'radio',
      name: 'r',
      value: 'b',
      checked: v === 'b',
      onChange: () => {
        p.handles.onChange('b');
        setV('b');
      },
    }),
  );
}

let container: HTMLElement;
let root: Root;

/** Mounts synchronously (flushSync forces the render commit) and returns the handles. */
function mount<P extends { handles: Handles }>(component: (p: P) => unknown, props: Omit<P, 'handles'> = {} as Omit<P, 'handles'>): Handles {
  const handles = makeHandles();
  flushSync(() => {
    root.render(createElement(component as (p: P) => null, { ...props, handles } as P));
  });
  return handles;
}

const field = () => document.querySelector('#field') as HTMLInputElement;
const mirror = () => document.querySelector('#mirror')!.textContent;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('type against a real React controlled input (#10)', () => {
  it('(a) updates React state and the DOM when the component accepts the value', async () => {
    const h = mount(ControlledField, { tag: 'input' });
    const r = await typeViaCli('#field', 'sentinel');
    expect(r).toMatchObject({
      success: true,
      tagName: 'INPUT',
      value: 'sentinel',
      requestedValue: 'sentinel',
      previousValue: '',
      verified: true,
      verification: 'matched',
    });
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledWith('sentinel');
    expect(h.state()).toBe('sentinel');
    expect(mirror()).toBe('sentinel');
    expect(field().value).toBe('sentinel');
  });

  it('(b) does NOT report success when React rejects the write (reverted) — and onChange DID fire', async () => {
    const h = mount(ControlledField, { tag: 'input', accept: false });
    const r = await typeViaCli('#field', 'sentinel');
    expect(r).toMatchObject({
      success: false,
      value: '',
      requestedValue: 'sentinel',
      previousValue: '',
      verified: false,
      verification: 'reverted',
    });
    expect(String(r.error)).toMatch(/^Value reverted/);
    expect(typeof r.hint).toBe('string');
    // The event reached React: the native setter bypassed the tracker.
    expect(h.onChange).toHaveBeenCalledWith('sentinel');
    expect(h.state()).toBe('');
    expect(mirror()).toBe('');
    expect(field().value).toBe('');
  });

  it('(c) --clear over a pre-filled controlled value emits the clear then the text', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: 'previous' });
    const r = await typeViaCli('#field', 'second', true);
    expect(r).toMatchObject({ success: true, value: 'second', previousValue: 'previous', verification: 'matched' });
    expect(h.onChange.mock.calls.map((c) => c[0])).toEqual(['', 'second']);
    expect(mirror()).toBe('second');
  });

  it('(c2) --clear against a pinned field reports reverted with the initial value', async () => {
    mount(ControlledField, { tag: 'input', accept: false, initial: 'previous' });
    const r = await typeViaCli('#field', 'second', true);
    expect(r).toMatchObject({ success: false, verification: 'reverted', value: 'previous' });
    expect(field().value).toBe('previous');
  });

  it('(d) works for a controlled <textarea> with newlines', async () => {
    const h = mount(ControlledField, { tag: 'textarea' });
    const r = await typeViaCli('#field', 'line1\nline2');
    expect(r).toMatchObject({ success: true, tagName: 'TEXTAREA', value: 'line1\nline2', verified: true });
    expect(h.state()).toBe('line1\nline2');
  });

  it('(e) transition-fed value: DOM is restored first and committed later — polling catches it', async () => {
    const h = mount(ControlledField, { tag: 'input', transition: true });
    const r = await typeViaCli('#field', 'sentinel');
    expect(r).toMatchObject({ success: true, value: 'sentinel', verified: true, verification: 'matched' });
    expect(h.state()).toBe('sentinel');
  });

  it('(e2) the same transition-fed value with verifyTimeoutMs 0 is deterministically reverted (why polling exists)', async () => {
    mount(ControlledField, { tag: 'input', transition: true });
    const r = await typeViaCli('#field', 'sentinel', false, { verifyTimeoutMs: 0 });
    expect(r).toMatchObject({ success: false, verification: 'reverted', value: '' });
  });

  it('(f) an app-transformed value is a soft success (verified:false, verification:transformed)', async () => {
    const h = mount(ControlledField, { tag: 'input', transform: (v: string) => v.toUpperCase() });
    const r = await typeViaCli('#field', 'sentinel');
    expect(r).toMatchObject({
      success: true,
      value: 'SENTINEL',
      requestedValue: 'sentinel',
      verified: false,
      verification: 'transformed',
    });
    expect(h.state()).toBe('SENTINEL');
  });

  it('(f2) an onFocus handler that reformats the value does not mask a rejected write', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: '1,000', accept: false, onFocus: (v: string) => v.replace(/,/g, '') });
    const r = await typeViaCli('#field', '42');
    expect(r).toMatchObject({ success: false, verification: 'reverted', value: '1000', previousValue: '1,000' });
    expect(h.onChange).toHaveBeenCalledWith('42');
    expect(field().value).toBe('1000');
  });

  it('(f3) the same onFocus reformat with an accepting handler is matched', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: '1,000', onFocus: (v: string) => v.replace(/,/g, '') });
    const r = await typeViaCli('#field', '42');
    expect(r).toMatchObject({ success: true, verification: 'matched', value: '42', previousValue: '1,000' });
    expect(h.state()).toBe('42');
  });

  it('(c3) --clear accepted but the real value rejected is reverted, not transformed', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: 'previous', accept: (v: string) => v === '' });
    const r = await typeViaCli('#field', 'sentinel', true);
    expect(r).toMatchObject({ success: false, verification: 'reverted', value: '', previousValue: 'previous' });
    expect(h.onChange.mock.calls.map((c) => c[0])).toEqual(['', 'sentinel']);
    expect(field().value).toBe('');
  });

  it('(i2) a value the browser discards (text into type=number) fails and restores the field', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="num" type="number" value="5">');
    const el = document.querySelector('#num') as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push('input'));
    const r = await typeViaCli('#num', 'abc');
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('Browser discarded the value');
    expect(r).toMatchObject({ value: '5', previousValue: '5', requestedValue: 'abc' });
    expect(el.value).toBe('5');
    expect(seen).toEqual([]);
  });

  it('(b2) an app that rejects by emptying the field is a failure, not a transformed success', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: 'foo', accept: false, resetTo: '' });
    const r = await typeViaCli('#field', 'sentinel');
    expect(r).toMatchObject({ success: false, verification: 'reverted', value: '', previousValue: 'foo' });
    expect(String(r.error)).toMatch(/^Value cleared/);
    expect(h.state()).toBe('');
  });

  it('(r1) an element re-mounted on focus is re-resolved before the write (accepting app → matched)', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: 'previous', remountOnFocus: true });
    const r = await typeViaCli('#field', 'sentinel');
    expect(r).toMatchObject({ success: true, verification: 'matched', value: 'sentinel', previousValue: 'previous' });
    expect(h.onChange).toHaveBeenCalledWith('sentinel');
    expect(h.state()).toBe('sentinel');
    expect(field().value).toBe('sentinel');
  });

  it('(r2) an element re-mounted on every change survives --clear (accepting → matched, pinned → reverted)', async () => {
    const h = mount(ControlledField, { tag: 'input', initial: 'previous', remountOnChange: true });
    const r = await typeViaCli('#field', 'second', true);
    expect(r).toMatchObject({ success: true, verification: 'matched', value: 'second' });
    expect(h.onChange.mock.calls.map((c) => c[0])).toEqual(['', 'second']);
    expect(h.state()).toBe('second');
    root.unmount();
    root = createRoot(container);
    mount(ControlledField, { tag: 'input', initial: 'previous', remountOnChange: true, accept: false });
    const r2 = await typeViaCli('#field', 'second', true);
    expect(r2).toMatchObject({ success: false, verification: 'reverted', value: 'previous' });
  });

  it('(i3) --clear then a browser-discarded value restores the previous value and tells the app', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="num" type="number" value="5">');
    const el = document.querySelector('#num') as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push('input:' + el.value));
    const r = await typeViaCli('#num', 'abc', true);
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('Browser discarded the value');
    expect(el.value).toBe('5');
    expect(seen).toEqual(['input:', 'input:5']);
  });

  it('(i4) a value the browser clamps back onto the current value (type=range) is refused, not matched', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="rng" type="range" min="0" max="10" value="10">');
    const el = document.querySelector('#rng') as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push('input'));
    const r = await typeViaCli('#rng', '50');
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('Browser did not take the value');
    expect(r).toMatchObject({ value: '10', requestedValue: '50' });
    expect(seen).toEqual([]);
  });

  it('(i5) a browser-discarded value restores what the field held right before the write, not the pre-focus value', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="num" type="number" value="">');
    const el = document.querySelector('#num') as HTMLInputElement;
    el.addEventListener('focus', () => {
      el.value = '10';
    });
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push('input'));
    const r = await typeViaCli('#num', 'abc');
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('Browser discarded the value');
    expect(r).toMatchObject({ value: '10', previousValue: '', requestedValue: 'abc' });
    expect(el.value).toBe('10');
    expect(seen).toEqual([]);
  });

  it('(j2) a custom element that reflects value asynchronously is verified against the request', async () => {
    if (!customElements.get('async-input')) {
      customElements.define(
        'async-input',
        class extends HTMLElement {
          _v = '';
          _pending = '';
          get value() {
            return this._v;
          }
          set value(v: string) {
            this._pending = v;
            Promise.resolve().then(() => {
              this._v = this._pending;
            });
          }
        },
      );
    }
    document.body.insertAdjacentHTML('beforeend', '<async-input id="ai"></async-input>');
    const r = await typeViaCli('#ai', 'hi');
    expect(r).toMatchObject({ success: true, verification: 'matched', value: 'hi' });
  });

  it('(g) NEGATIVE CONTROL: the pre-fix script never reaches React and the DOM resets on the next commit', async () => {
    const h = mount(ControlledField, { tag: 'input' });
    const legacy = TypeResultSchema.parse(JSON.parse(String(await bridgeEval(LEGACY_TYPE_SCRIPT))));
    expect(legacy).toMatchObject({ success: true, value: 'sentinel' }); // the false positive
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.state()).toBe('');
    expect(mirror()).toBe('');
    expect(field().value).toBe('sentinel'); // a bare re-read alone cannot tell
    h.rerender();
    expect(field().value).toBe(''); // "input.value is empty on the next eval"
  });

  it('(h) a plain uncontrolled input outside React still works and gets input then change', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="plain" type="text">');
    const el = document.querySelector('#plain') as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push('input:' + el.value));
    el.addEventListener('change', () => seen.push('change:' + el.value));
    const r = await typeViaCli('#plain', 'hello');
    expect(r).toMatchObject({ success: true, value: 'hello', verified: true });
    expect(seen).toEqual(['input:hello', 'change:hello']);
  });

  it('(i) browser normalization: a text input strips newlines; compared against the applied value', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="plain" type="text">');
    const r = await typeViaCli('#plain', 'a\nb');
    expect(r).toMatchObject({ success: true, value: 'ab', requestedValue: 'a\nb', verified: true, verification: 'matched' });
  });

  it('(j) custom element with a prototype value accessor (Lit/Stencil shape) uses that setter', async () => {
    if (!customElements.get('fancy-input')) {
      customElements.define(
        'fancy-input',
        class extends HTMLElement {
          _v = '';
          get value() {
            return this._v;
          }
          set value(v: string) {
            this._v = v;
          }
        },
      );
    }
    document.body.insertAdjacentHTML('beforeend', '<fancy-input id="f"></fancy-input>');
    const r = await typeViaCli('#f', 'hi');
    expect(r).toMatchObject({ success: true, tagName: 'FANCY-INPUT', value: 'hi', verified: true });
  });

  it('(k) custom element with an instance-defined value falls back to assignment (no regression)', async () => {
    if (!customElements.get('field-input')) {
      customElements.define(
        'field-input',
        class extends HTMLElement {
          constructor() {
            super();
            Object.defineProperty(this, 'value', { value: '', writable: true, configurable: true });
          }
        },
      );
    }
    document.body.insertAdjacentHTML('beforeend', '<field-input id="fi"></field-input>');
    const r = await typeViaCli('#fi', 'hi');
    expect(r).toMatchObject({ success: true, value: 'hi' });
  });

  it('(l) a setter that throws yields a JSON failure, never a bridge ERROR', async () => {
    if (!customElements.get('boom-input')) {
      customElements.define(
        'boom-input',
        class extends HTMLElement {
          get value() {
            return '';
          }
          set value(_v: string) {
            throw new Error('boom');
          }
        },
      );
    }
    document.body.insertAdjacentHTML('beforeend', '<boom-input id="b"></boom-input>');
    const r = await typeViaCli('#b', 'x');
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('boom');
  });

  it('(m) a contenteditable <div> is refused instead of getting an expando property', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="ce" contenteditable="true"></div>');
    const r = await typeViaCli('#ce', 'x');
    expect(r.success).toBe(false);
    expect(String(r.error)).toBe('Unsupported element <div>: no value setter');
  });

  it('(n) a checkbox via type is refused with a --toggle hint', async () => {
    mount(ControlledCheckbox);
    const r = await typeViaCli('#cb', 'x');
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('--toggle');
  });

  it('(o) a missing selector keeps the "Element not found" contract', async () => {
    const r = await typeViaCli('#nope', 'x');
    expect(r).toMatchObject({ success: false, error: 'Element not found' });
  });
});

describe('select against real React controlled elements', () => {
  it('(s1) value mode updates a controlled <select> and its state', async () => {
    const h = mount(ControlledSelect);
    const r = await selectViaCli('#sel', 'US');
    expect(r).toMatchObject({ success: true, tagName: 'select', value: 'US', previousValue: 'CA', verified: true });
    expect(h.onChange).toHaveBeenCalledWith('US');
    expect(h.state()).toBe('US');
  });

  it('(s2) a pinned <select> reports reverted with the restored value', async () => {
    mount(ControlledSelect, { accept: false });
    const r = await selectViaCli('#sel', 'US');
    expect(r).toMatchObject({ success: false, verification: 'reverted', value: 'CA' });
    expect(mirror()).toBe('CA');
  });

  it('(s3) a value matching no <option> fails fast and lists the option values', async () => {
    mount(ControlledSelect);
    const r = await selectViaCli('#sel', 'United States');
    expect(r).toMatchObject({ success: false, options: ['CA', 'US'] });
    expect(String(r.error)).toContain('No <option>');
    expect((document.querySelector('#sel') as HTMLSelectElement).value).toBe('CA');
  });

  it('(s4) value mode on a controlled <input> (the usage the help advertises) reaches React', async () => {
    const h = mount(ControlledField, { tag: 'input' });
    const r = await selectViaCli('#field', 'hello world');
    expect(r).toMatchObject({ success: true, tagName: 'input', value: 'hello world', verified: true });
    expect(h.state()).toBe('hello world');
  });

  it('(s5) --toggle flips a controlled checkbox exactly once via click()', async () => {
    const h = mount(ControlledCheckbox);
    const r = await selectViaCli('#cb', undefined, true);
    expect(r).toMatchObject({ success: true, checked: true, previousChecked: false, verified: true });
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledWith(true);
    expect(h.state()).toBe('true');
  });

  it('(s6) --toggle on a pinned checkbox reports reverted', async () => {
    mount(ControlledCheckbox, { accept: false });
    const r = await selectViaCli('#cb', undefined, true);
    expect(r).toMatchObject({ success: false, checked: false, previousChecked: false, verification: 'reverted' });
    expect((document.querySelector('#cb') as HTMLInputElement).checked).toBe(false);
  });

  it('(s7) NEGATIVE CONTROL: the pre-fix checked-assignment + change/input never reaches React', async () => {
    const h = mount(ControlledCheckbox);
    const legacy = SelectResultSchema.parse(JSON.parse(String(await bridgeEval(LEGACY_TOGGLE_SCRIPT))));
    expect(legacy).toMatchObject({ success: true, checked: true }); // the false positive
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.state()).toBe('false');
    h.rerender();
    expect((document.querySelector('#cb') as HTMLInputElement).checked).toBe(false);
  });

  it('(s8) a disabled checkbox and a <fieldset disabled> descendant are refused', async () => {
    mount(ControlledCheckbox, { disabled: true });
    expect(String((await selectViaCli('#cb', undefined, true)).error)).toContain('disabled');
    root.unmount();
    root = createRoot(container);
    mount(ControlledCheckbox, { fieldsetDisabled: true });
    expect(String((await selectViaCli('#cb', undefined, true)).error)).toContain('disabled');
  });

  it('(s9) radio: toggling the unchecked sibling selects it; toggling the checked one is refused', async () => {
    const h = mount(ControlledRadios);
    expect(String((await selectViaCli('#ra', undefined, true)).error)).toContain('already checked');
    const r = await selectViaCli('#rb', undefined, true);
    expect(r).toMatchObject({ success: true, checked: true });
    expect(h.state()).toBe('b');
  });

  it('(s10) --toggle on a non-checkable element is refused', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="d"></div>');
    const r = await selectViaCli('#d', undefined, true);
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('not a checkbox or radio');
  });

  it('(s11) --toggle on a checkbox the app unmounts in its change handler fails explicitly instead of reading the detached node', async () => {
    function SelfRemovingCheckbox(_p: { handles: Handles }) {
      const [gone, setGone] = useState(false);
      if (gone) return createElement('span', { id: 'removed' });
      return createElement('input', { id: 'cb', type: 'checkbox', checked: false, onChange: () => setGone(true) });
    }
    mount(SelfRemovingCheckbox);
    const r = await selectViaCli('#cb', undefined, true);
    expect(document.querySelector('#cb')).toBeNull();
    expect(document.querySelector('#removed')).not.toBeNull();
    expect(r).toMatchObject({ success: false, verified: false, previousChecked: false });
    expect(String(r.error)).toContain('left the document');
    expect(r.verification).toBeUndefined();
  });
});
