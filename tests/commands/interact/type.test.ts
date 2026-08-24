import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTypeScript } from '../../../src/commands/interact/type.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test-token', pid: 12345 }),
}));

describe('buildTypeScript', () => {
  it('generates a script with querySelector for the given selector', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("var selector = '#username';");
    expect(script).toContain('document.querySelector(selector)');
  });

  it('generates a script that focuses the element', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain('el.focus()');
  });

  it('writes the text through the native setter, never through el.value = (#10)', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain('var requested = "hello";');
    expect(script).toContain('writer.set(requested)');
    expect(script).not.toMatch(/\bel\.value\s*=/);
  });

  it('resolves the prototype value setter for input/textarea/select', () => {
    const script = buildTypeScript('#username', 'hello', false);
    for (const token of [
      'HTMLInputElement.prototype',
      'HTMLTextAreaElement.prototype',
      'HTMLSelectElement.prototype',
      "Object.getOwnPropertyDescriptor(proto, 'value')",
      'd.set.call(node, v)',
    ]) {
      expect(script).toContain(token);
    }
  });

  it('dispatches input event with bubbles: true', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("new Event('input', { bubbles: true })");
  });

  it('dispatches change event with bubbles: true', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("new Event('change', { bubbles: true })");
  });

  it('dispatches input before change', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script.indexOf("new Event('input'")).toBeLessThan(script.indexOf("new Event('change'"));
  });

  it('returns JSON with success: true and element info', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain('success: true');
    expect(script).toContain('el.tagName');
    expect(script).toContain('el.value');
  });

  it('returns JSON with success: false when element not found', () => {
    const script = buildTypeScript('#missing', 'hello', false);
    expect(script).toContain('success: false');
    expect(script).toContain('Element not found');
  });

  it('wraps in an arrow IIFE that returns a Promise (the bridge awaits it)', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script.trim()).toMatch(/^\(\(\) =>/);
    expect(script.trim()).toMatch(/\)\(\)$/);
    expect(script).toContain('new Promise(');
  });

  it('refuses checkbox/radio/file inputs and elements without a setter', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain('Cannot set a text value on <input type=');
    expect(script).toContain('browsers reject scripted file values');
    expect(script).toContain('no value setter');
  });

  it('pre-checks <select> options', () => {
    const script = buildTypeScript('#s', 'x', false);
    expect(script).toContain('No <option> with value');
  });

  it('classifies reverted vs transformed and never throws into the bridge', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("verification: 'matched'");
    expect(script).toContain("verification: 'transformed'");
    expect(script).toContain("verification: 'reverted'");
    expect(script).toContain('Value reverted');
    expect(script).toContain('} catch (e) {');
    expect(script).toContain('Script error: ');
  });

  it('settles after focus/clear and compares the re-read against the settled baseline', () => {
    const script = buildTypeScript('#username', 'hello', true);
    expect(script).toContain('__settle().then(');
    expect(script).toContain('var baseline = String(el.value);');
    expect(script).toContain('observed === baseline || observed === previousValue');
    // previousValue is snapshotted before focus/clear; baseline after they settle
    expect(script.indexOf('var previousValue')).toBeLessThan(script.indexOf("writer.set('')"));
    expect(script.indexOf("writer.set('')")).toBeLessThan(script.indexOf('var baseline'));
  });

  it('refuses a value the browser sanitizes away and restores the baseline', () => {
    const script = buildTypeScript('#n', 'abc', false);
    expect(script).toContain("writer.kind === 'native' && requested !== '' && applied === ''");
    expect(script).toContain('writer.set(previousValue)');
    expect(script).toContain('Browser discarded the value');
    expect(script).toContain('Browser did not take the value');
    expect(script).toContain('Value cleared');
    expect(script).toContain('Element left the document');
  });

  describe('verify timeout', () => {
    it('embeds the default verify timeout and interval', () => {
      expect(buildTypeScript('#u', 'x', false)).toContain(', 500, 50)');
    });

    it('embeds a custom verify timeout', () => {
      expect(buildTypeScript('#u', 'x', false, { verifyTimeoutMs: 2500 })).toContain(', 2500, 50)');
    });

    it.each([-1, 4001, 1.5, NaN])('rejects verifyTimeoutMs %p', (ms) => {
      expect(() => buildTypeScript('#u', 'x', false, { verifyTimeoutMs: ms })).toThrow(/--verify-timeout/);
    });
  });

  describe('clear option', () => {
    it('includes a guarded select() and a native-setter reset when clear is true', () => {
      const script = buildTypeScript('#username', 'hello', true);
      expect(script).toContain("if (typeof el.select === 'function') el.select()");
      expect(script).toContain("writer.set('')");
    });

    it('dispatches input event after clearing', () => {
      const countInputs = (script: string) => (script.match(/new Event\('input'/g) ?? []).length;
      // With --clear: one for the clear, one for the write, and one in the
      // restore-after-discard branch (only runs when the clear already fired).
      const script = buildTypeScript('#username', 'hello', true);
      expect(countInputs(script)).toBe(3);
      expect(script.indexOf("writer.set('')")).toBeLessThan(script.indexOf("new Event('input'"));
      // Without --clear: the write plus the (inert) restore branch.
      expect(countInputs(buildTypeScript('#username', 'hello', false))).toBe(2);
    });

    it('does not include select when clear is false', () => {
      const script = buildTypeScript('#username', 'hello', false);
      expect(script).not.toContain('el.select()');
      expect(script).not.toContain("writer.set('')");
    });
  });

  describe('special characters in text', () => {
    const requestedLiteral = (script: string): string => {
      const match = script.match(/var requested = (.+);/);
      expect(match).not.toBeNull();
      return match![1]!;
    };

    it('safely embeds text with double quotes using JSON.stringify', () => {
      const script = buildTypeScript('#input', 'say "hello"', false);
      // JSON.stringify will escape the quotes
      expect(script).toContain('"say \\"hello\\""');
    });

    it('safely embeds text with single quotes', () => {
      const script = buildTypeScript('#input', "it's alive", false);
      expect(script).toContain("it's alive");
      // The value should be valid JSON
      expect(() => JSON.parse(requestedLiteral(script))).not.toThrow();
    });

    it('safely embeds text with backslashes', () => {
      const script = buildTypeScript('#input', 'path\\to\\file', false);
      expect(JSON.parse(requestedLiteral(script))).toBe('path\\to\\file');
    });

    it('safely embeds text with newlines', () => {
      const script = buildTypeScript('#textarea', 'line1\nline2', false);
      expect(JSON.parse(requestedLiteral(script))).toBe('line1\nline2');
    });

    it('safely handles empty string', () => {
      const script = buildTypeScript('#input', '', false);
      expect(script).toContain('var requested = "";');
    });
  });

  describe('selector escaping', () => {
    it('escapes single quotes in selector', () => {
      const script = buildTypeScript("input[name='email']", 'test', false);
      expect(script).toContain("input[name=\\'email\\']");
    });
  });
});

describe('registerType command integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetch(result: unknown) {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result }),
    });
    vi.stubGlobal('fetch', mockFetch);
    return mockFetch;
  }

  async function runType(args: string[]) {
    const { Command } = await import('commander');
    const { registerType } = await import('../../../src/commands/interact/type.js');
    const program = new Command();
    program.exitOverride();
    registerType(program);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await program.parseAsync(['node', 'test', 'type', ...args]);
      return logSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      logSpy.mockRestore();
    }
  }

  it('types text and prints human-readable output', async () => {
    stubFetch(JSON.stringify({ success: true, selector: '#username', tagName: 'INPUT', value: 'admin' }));
    const output = await runType(['#username', 'admin']);
    expect(output).toHaveLength(1);
    expect(output[0]).toBe('Typed into input: "admin"');
  });

  it('outputs JSON when --json flag is set', async () => {
    stubFetch(JSON.stringify({ success: true, selector: '#email', tagName: 'INPUT', value: 'user@example.com' }));
    const output = await runType(['#email', 'user@example.com', '--json']);
    const parsed = JSON.parse(output[0]!);
    expect(parsed.success).toBe(true);
    expect(parsed.value).toBe('user@example.com');
    expect(parsed.tagName).toBe('INPUT');
  });

  it('throws when element not found', async () => {
    stubFetch(JSON.stringify({ success: false, selector: '#missing', error: 'Element not found' }));
    await expect(runType(['#missing', 'hello'])).rejects.toThrow('Type failed: Element not found');
  });

  it('passes --clear option to the generated script', async () => {
    const mockFetch = stubFetch(JSON.stringify({ success: true, selector: '#search', tagName: 'INPUT', value: 'new text' }));
    await runType(['#search', 'new text', '--clear']);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.js).toContain("if (typeof el.select === 'function') el.select()");
    expect(body.js).toContain("writer.set('')");
  });

  it('passes --verify-timeout to the generated script', async () => {
    const mockFetch = stubFetch(JSON.stringify({ success: true, selector: '#q', tagName: 'INPUT', value: 'x' }));
    await runType(['#q', 'x', '--verify-timeout', '2500']);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.js).toContain(', 2500, 50)');
  });

  it('rejects an out-of-range --verify-timeout before calling the bridge', async () => {
    const mockFetch = stubFetch(JSON.stringify({ success: true }));
    await expect(runType(['#q', 'x', '--verify-timeout', '9000'])).rejects.toThrow(/--verify-timeout/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws with the hint when the framework reverted the write', async () => {
    stubFetch(
      JSON.stringify({
        success: false,
        selector: '#q',
        tagName: 'INPUT',
        value: '',
        requestedValue: 'sentinel',
        previousValue: '',
        verified: false,
        verification: 'reverted',
        error: 'Value reverted: wrote "sentinel" but the element reads "" again after 500ms',
        hint: 'The app restored the previous value.',
      }),
    );
    await expect(runType(['#q', 'sentinel'])).rejects.toThrow(
      /Type failed: Value reverted: wrote "sentinel" but the element reads "" again after 500ms \(selector: #q\)\n {2}hint: The app restored the previous value\./,
    );
  });

  it('notes an app-transformed value in human output', async () => {
    stubFetch(
      JSON.stringify({
        success: true,
        selector: '#q',
        tagName: 'INPUT',
        value: 'SENTINEL',
        requestedValue: 'sentinel',
        verified: false,
        verification: 'transformed',
      }),
    );
    const output = await runType(['#q', 'sentinel']);
    expect(output[0]).toBe('Typed into input: "SENTINEL" (app transformed the requested value "sentinel")');
  });

  it('notes a browser-normalized value in human output', async () => {
    stubFetch(
      JSON.stringify({
        success: true,
        selector: '#q',
        tagName: 'INPUT',
        value: 'ab',
        requestedValue: 'a\nb',
        verified: true,
        verification: 'matched',
      }),
    );
    const output = await runType(['#q', 'a\nb']);
    expect(output[0]).toBe('Typed into input: "ab" (browser normalized the requested value "a\\nb")');
  });

  it('surfaces a bridge "ERROR: …" result as an actionable error instead of a SyntaxError', async () => {
    stubFetch('ERROR: boom');
    await expect(runType(['#q', 'x'])).rejects.toThrow('Type failed: the bridge script threw: boom');
  });

  it('registers --verify-timeout with a default of 500', async () => {
    const { Command } = await import('commander');
    const { registerType } = await import('../../../src/commands/interact/type.js');
    const program = new Command();
    registerType(program);
    const cmd = program.commands.find((c) => c.name() === 'type')!;
    const opt = cmd.options.find((o) => o.long === '--verify-timeout');
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe(500);
  });
});
