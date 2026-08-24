import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { buildSelectScript, registerSelect } from '../../../src/commands/interact/select.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test-token', pid: 12345 }),
  discoverBridgesByPid: vi.fn(),
}));

describe('buildSelectScript', () => {
  describe('value mode (toggle = false)', () => {
    it('writes the value through the native setter and dispatches input then change (#10)', () => {
      const script = buildSelectScript('select#country', 'US');
      expect(script).toContain("var selector = 'select#country';");
      expect(script).toContain('document.querySelector(selector)');
      expect(script).toContain('var requested = "US";');
      expect(script).toContain('writer.set(requested)');
      expect(script).not.toMatch(/\bel\.value\s*=/);
      expect(script).toContain("new Event('input', { bubbles: true })");
      expect(script).toContain("new Event('change', { bubbles: true })");
      expect(script.indexOf("new Event('input'")).toBeLessThan(script.indexOf("new Event('change'"));
    });

    it('returns success JSON with selector, tagName, and value', () => {
      const script = buildSelectScript('#my-select', 'option1');
      expect(script).toContain('success: true');
      expect(script).toContain('el.tagName.toLowerCase()');
      expect(script).toContain('el.value');
    });

    it('returns error when element not found', () => {
      const script = buildSelectScript('.missing', 'val');
      expect(script).toContain("'Element not found: ' + selector");
      expect(script).toContain('success: false');
    });

    it('wraps in an arrow IIFE that returns a Promise', () => {
      const script = buildSelectScript('select', 'opt');
      expect(script.trim()).toMatch(/^\(\(\) =>/);
      expect(script).toContain('})()');
      expect(script).toContain('new Promise(');
    });

    it('handles empty string value', () => {
      const script = buildSelectScript('input#field', '');
      expect(script).toContain('var requested = "";');
    });

    it('handles undefined value (sets empty string)', () => {
      const script = buildSelectScript('input#field', undefined, false);
      expect(script).toContain('var requested = "";');
    });

    it('pre-checks <select> options and reports them on a miss', () => {
      const script = buildSelectScript('#sel', 'x');
      expect(script).toContain('__selectOptionValues(el)');
      expect(script).toContain('options.slice(0, 50)');
      expect(script).toContain('No <option> with value');
    });

    it('does not focus the element (unchanged select behaviour)', () => {
      const script = buildSelectScript('#sel', 'x');
      expect(script).not.toContain('el.focus()');
    });

    it('embeds the verify timeout and rejects out-of-range values', () => {
      expect(buildSelectScript('#sel', 'x')).toContain(', 500, 50)');
      expect(buildSelectScript('#sel', 'x', false, { verifyTimeoutMs: 1200 })).toContain(', 1200, 50)');
      expect(() => buildSelectScript('#sel', 'x', false, { verifyTimeoutMs: 4001 })).toThrow(/--verify-timeout/);
    });
  });

  describe('toggle mode (toggle = true)', () => {
    it('performs a native click() instead of assigning el.checked', () => {
      const script = buildSelectScript('input[type="checkbox"]', undefined, true);
      expect(script).toContain('el.click()');
      expect(script).not.toMatch(/\bel\.checked\s*=/);
    });

    it('does not dispatch synthetic change/input events (click() fires them natively)', () => {
      const script = buildSelectScript('#checkbox', undefined, true);
      expect(script).not.toContain("new Event('change'");
      expect(script).not.toContain("new Event('input'");
    });

    it('returns success JSON with checked state and verification', () => {
      const script = buildSelectScript('#checkbox', undefined, true);
      expect(script).toContain('success: true');
      expect(script).toContain('checked: v.observed');
      expect(script).toContain('previousChecked: before');
      expect(script).toContain("verification: 'reverted'");
      expect(script).toContain('Checked state reverted');
    });

    it('fails explicitly when the clicked element leaves the document instead of reading the detached node', () => {
      const script = buildSelectScript('#cb', undefined, true);
      expect(script).toContain('document.querySelector(selector) || (el.isConnected ? el : null)');
      expect(script).toContain('return cur ? !!cur.checked : null;');
      expect(script).toContain('if (v.observed === null)');
      expect(script).toContain('Element left the document after click()');
    });

    it('does not set el.value in toggle mode', () => {
      const script = buildSelectScript('#checkbox', 'ignored', true);
      expect(script).not.toContain('el.value');
    });

    it('returns error when element not found', () => {
      const script = buildSelectScript('.gone', undefined, true);
      expect(script).toContain('Element not found');
    });

    it('refuses non-checkable, disabled and already-checked radio elements', () => {
      const script = buildSelectScript('#cb', undefined, true);
      expect(script).toContain('is not a checkbox or radio');
      expect(script).toContain("matches(':disabled')");
      expect(script).toContain("closest('fieldset[disabled]')");
      expect(script).toContain('Element is disabled');
      expect(script).toContain('Radio input is already checked');
    });

    it('embeds the verify timeout and never throws into the bridge', () => {
      const script = buildSelectScript('#cb', undefined, true, { verifyTimeoutMs: 800 });
      expect(script).toContain(', 800, 50)');
      expect(script).toContain('} catch (e) {');
      expect(script).toContain('Script error: ');
    });
  });

  describe('selector and value escaping', () => {
    it('escapes single quotes in selector', () => {
      const script = buildSelectScript("input[name='agree']", 'yes');
      expect(script).toContain("input[name=\\'agree\\']");
    });

    it('embeds the value as JSON so quotes survive', () => {
      const script = buildSelectScript('#input', "it's a value");
      expect(script).toContain('var requested = "it\'s a value";');
    });

    it('embeds newlines safely (previously a script syntax error)', () => {
      const script = buildSelectScript('#input', 'x\ny');
      const match = script.match(/var requested = (.+);/);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]!)).toBe('x\ny');
    });
  });
});

describe('registerSelect', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerSelect(program);
    return program;
  }

  it('registers select command', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'select');
    expect(cmd).toBeDefined();
  });

  it('has selector argument and optional value argument', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'select')!;
    expect(cmd.registeredArguments.length).toBe(2);
    expect(cmd.registeredArguments[0]?.name()).toBe('selector');
    expect(cmd.registeredArguments[1]?.name()).toBe('value');
  });

  it('has --toggle option', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'select')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--toggle');
  });

  it('has --verify-timeout option with a default of 500', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'select')!;
    const opt = cmd.options.find((o) => o.long === '--verify-timeout');
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe(500);
  });

  it('has bridge options', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'select')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--port');
    expect(optionNames).toContain('--token');
  });

  it('has expected description', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'select')!;
    expect(cmd.description()).toBe('Set the value of a form element or toggle a checkbox');
  });

  describe('with a mocked bridge', () => {
    beforeEach(() => {
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

    /** Runs `select`, returning what reached stdout plus the rejection (if any) — for failure-path assertions. */
    async function runSelectCapturing(args: string[]): Promise<{ logs: string[]; error?: Error }> {
      const program = createProgram();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await program.parseAsync(['node', 'test', 'select', ...args]);
        return { logs: logSpy.mock.calls.map((c) => String(c[0])) };
      } catch (err) {
        return { logs: logSpy.mock.calls.map((c) => String(c[0])), error: err as Error };
      } finally {
        logSpy.mockRestore();
      }
    }

    async function runSelect(args: string[]) {
      const { logs, error } = await runSelectCapturing(args);
      if (error) throw error;
      return logs;
    }

    it('prints the JSON result on success', async () => {
      stubFetch(JSON.stringify({ success: true, selector: '#cb', tagName: 'input', checked: true, verified: true }));
      const output = await runSelect(['#cb', '--toggle']);
      expect(JSON.parse(output[0]!)).toMatchObject({ success: true, checked: true });
    });

    it('throws with the hint when the checked state reverted', async () => {
      stubFetch(
        JSON.stringify({
          success: false,
          selector: '#cb',
          tagName: 'input',
          checked: false,
          previousChecked: false,
          verification: 'reverted',
          error: 'Checked state reverted: click() set checked=true but the element reads false after 500ms',
          hint: 'A controlled checkbox whose change handler did not accept the change.',
        }),
      );
      await expect(runSelect(['#cb', '--toggle'])).rejects.toThrow(
        /Checked state reverted: click\(\) set checked=true but the element reads false after 500ms\n {2}hint: A controlled checkbox/,
      );
    });

    it('prints the failure object to stdout before exiting non-zero (verification: "reverted")', async () => {
      stubFetch(
        JSON.stringify({
          success: false,
          selector: '#cb',
          tagName: 'input',
          checked: false,
          previousChecked: false,
          verified: false,
          verification: 'reverted',
          error: 'Checked state reverted: click() set checked=true but the element reads false after 500ms',
          hint: 'A controlled checkbox whose change handler did not accept the change.',
        }),
      );
      const { logs, error } = await runSelectCapturing(['#cb', '--toggle']);
      expect(error?.message).toMatch(/^Checked state reverted/);
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0]!)).toMatchObject({ success: false, verification: 'reverted', previousChecked: false, verified: false });
    });

    it('prints the available options to stdout when no <option> matches the value', async () => {
      stubFetch(
        JSON.stringify({
          success: false,
          selector: '#sel',
          tagName: 'select',
          requestedValue: 'Canada',
          options: ['CA', 'US'],
          error: 'No <option> with value "Canada"',
          hint: 'Pass the option value attribute, not its label. Available values: CA, US',
        }),
      );
      const { logs, error } = await runSelectCapturing(['#sel', 'Canada']);
      expect(error?.message).toMatch(/^No <option> with value "Canada"\n {2}hint: Pass the option value attribute/);
      expect(JSON.parse(logs[0]!)).toMatchObject({ success: false, options: ['CA', 'US'], requestedValue: 'Canada' });
    });

    it('surfaces a bridge "ERROR: …" result as an actionable error', async () => {
      stubFetch('ERROR: boom');
      await expect(runSelect(['#sel', 'US'])).rejects.toThrow('Select failed: the bridge script threw: boom');
    });

    it('rejects an out-of-range --verify-timeout before calling the bridge', async () => {
      const mockFetch = stubFetch(JSON.stringify({ success: true }));
      await expect(runSelect(['#sel', 'US', '--verify-timeout', '-5'])).rejects.toThrow(/--verify-timeout/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
