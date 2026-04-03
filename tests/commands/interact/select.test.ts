import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { buildSelectScript, registerSelect } from '../../../src/commands/interact/select.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('buildSelectScript', () => {
  describe('value mode (toggle = false)', () => {
    it('sets el.value and dispatches change and input events', () => {
      const script = buildSelectScript('select#country', 'US');
      expect(script).toContain("document.querySelector('select#country')");
      expect(script).toContain("el.value = 'US'");
      expect(script).toContain("new Event('change', { bubbles: true })");
      expect(script).toContain("new Event('input', { bubbles: true })");
    });

    it('returns success JSON with selector, tagName, and value', () => {
      const script = buildSelectScript('#my-select', 'option1');
      expect(script).toContain('success: true');
      expect(script).toContain('el.tagName.toLowerCase()');
      expect(script).toContain('el.value');
    });

    it('returns error when element not found', () => {
      const script = buildSelectScript('.missing', 'val');
      expect(script).toContain('Element not found');
      expect(script).toContain('success: false');
    });

    it('wraps in IIFE', () => {
      const script = buildSelectScript('select', 'opt');
      expect(script.trim()).toMatch(/^\(function\(\)/);
      expect(script).toContain('})()');
    });

    it('handles empty string value', () => {
      const script = buildSelectScript('input#field', '');
      expect(script).toContain("el.value = ''");
    });

    it('handles undefined value (sets empty string)', () => {
      const script = buildSelectScript('input#field', undefined, false);
      expect(script).toContain("el.value = ''");
    });
  });

  describe('toggle mode (toggle = true)', () => {
    it('flips el.checked', () => {
      const script = buildSelectScript('input[type="checkbox"]', undefined, true);
      expect(script).toContain('el.checked = !el.checked');
    });

    it('dispatches change and input events', () => {
      const script = buildSelectScript('#checkbox', undefined, true);
      expect(script).toContain("new Event('change', { bubbles: true })");
      expect(script).toContain("new Event('input', { bubbles: true })");
    });

    it('returns success JSON with checked state', () => {
      const script = buildSelectScript('#checkbox', undefined, true);
      expect(script).toContain('success: true');
      expect(script).toContain('el.checked');
    });

    it('does not set el.value in toggle mode', () => {
      const script = buildSelectScript('#checkbox', 'ignored', true);
      expect(script).not.toContain('el.value');
    });

    it('returns error when element not found', () => {
      const script = buildSelectScript('.gone', undefined, true);
      expect(script).toContain('Element not found');
    });
  });

  describe('selector escaping', () => {
    it('escapes single quotes in selector', () => {
      const script = buildSelectScript("input[name='agree']", 'yes');
      expect(script).toContain("input[name=\\'agree\\']");
    });

    it('escapes single quotes in value', () => {
      const script = buildSelectScript('#input', "it's a value");
      expect(script).toContain("it\\'s a value");
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
});
