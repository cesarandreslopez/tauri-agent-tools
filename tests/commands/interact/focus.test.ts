import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { buildFocusScript, registerFocus } from '../../../src/commands/interact/focus.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('buildFocusScript', () => {
  it('generates script that queries element and calls focus()', () => {
    const script = buildFocusScript('#my-input');
    expect(script).toContain("document.querySelector('#my-input')");
    expect(script).toContain('el.focus()');
  });

  it('returns success JSON with selector and tagName', () => {
    const script = buildFocusScript('button.submit');
    expect(script).toContain('success: true');
    expect(script).toContain('el.tagName.toLowerCase()');
    expect(script).toContain("'button.submit'");
  });

  it('returns error when element not found', () => {
    const script = buildFocusScript('.missing');
    expect(script).toContain('Element not found');
    expect(script).toContain('success: false');
  });

  it('wraps in IIFE', () => {
    const script = buildFocusScript('input');
    expect(script.trim()).toMatch(/^\(function\(\)/);
    expect(script).toContain('})()');
  });

  it('escapes single quotes in selector', () => {
    const script = buildFocusScript("input[name='email']");
    expect(script).toContain("input[name=\\'email\\']");
  });

  it('catches errors and returns error JSON', () => {
    const script = buildFocusScript('#el');
    expect(script).toContain('catch (e)');
    expect(script).toContain('String(e)');
  });
});

describe('registerFocus', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerFocus(program);
    return program;
  }

  it('registers focus command', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'focus');
    expect(cmd).toBeDefined();
  });

  it('has selector argument', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'focus')!;
    expect(cmd.registeredArguments.length).toBe(1);
    expect(cmd.registeredArguments[0]?.name()).toBe('selector');
  });

  it('has bridge options', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'focus')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--port');
    expect(optionNames).toContain('--token');
  });

  it('has expected description', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'focus')!;
    expect(cmd.description()).toBe('Focus a DOM element by CSS selector');
  });
});
