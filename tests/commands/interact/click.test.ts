import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

import { buildClickScript } from '../../../src/commands/interact/click.js';

describe('buildClickScript', () => {
  it('generates a script with querySelector for the given selector', () => {
    const script = buildClickScript('#submit-btn', { double: false, right: false });
    expect(script).toContain("querySelector('#submit-btn')");
  });

  it('includes mousedown and mouseup events', () => {
    const script = buildClickScript('.btn', { double: false, right: false });
    expect(script).toContain("'mousedown'");
    expect(script).toContain("'mouseup'");
  });

  it('includes click event for normal click', () => {
    const script = buildClickScript('.btn', { double: false, right: false });
    expect(script).toContain("'click'");
    expect(script).not.toContain("'dblclick'");
    expect(script).not.toContain("'contextmenu'");
  });

  it('includes dblclick for double-click', () => {
    const script = buildClickScript('.btn', { double: true, right: false });
    expect(script).toContain("'click'");
    expect(script).toContain("'dblclick'");
    expect(script).not.toContain("'contextmenu'");
  });

  it('includes contextmenu but not click for right-click', () => {
    const script = buildClickScript('.item', { double: false, right: true });
    expect(script).toContain("'contextmenu'");
    expect(script).not.toContain("'click'");
    expect(script).not.toContain("'dblclick'");
  });

  it('sets button: 2 for right-click', () => {
    const script = buildClickScript('.item', { double: false, right: true });
    expect(script).toContain('button: 2');
  });

  it('sets button: 0 for normal click', () => {
    const script = buildClickScript('.item', { double: false, right: false });
    expect(script).toContain('button: 0');
  });

  it('handles element not found — returns error JSON', () => {
    const script = buildClickScript('#missing', { double: false, right: false });
    // The script should have a branch returning success: false
    expect(script).toContain('success: false');
    expect(script).toContain('Element not found');
  });

  it('returns success JSON with tagName and text on success', () => {
    const script = buildClickScript('button', { double: false, right: false });
    expect(script).toContain('success: true');
    expect(script).toContain('tagName');
    expect(script).toContain('textContent');
  });

  it('uses IIFE pattern', () => {
    const script = buildClickScript('div', { double: false, right: false });
    expect(script.trim()).toMatch(/^\(\(\)/);
    expect(script.trim()).toMatch(/\)\(\)$/);
  });

  it('escapes single quotes in selectors', () => {
    const script = buildClickScript("[data-label='foo']", { double: false, right: false });
    expect(script).toContain("\\'");
  });

  it('truncates text to 100 chars', () => {
    const script = buildClickScript('p', { double: false, right: false });
    expect(script).toContain('.slice(0, 100)');
  });
});

describe('click command — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('outputs human-readable result for successful click', async () => {
    const successResult = JSON.stringify({
      success: true,
      selector: 'button.submit',
      tagName: 'button',
      text: 'Submit',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: successResult }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerClick } = await import('../../../src/commands/interact/click.js');
    const program = new Command();
    program.exitOverride();
    registerClick(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'click', 'button.submit', '--port', '9999', '--token', 'tok']);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('clicked');
    expect(output).toContain('button');
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('outputs JSON when --json flag is set', async () => {
    const successResult = JSON.stringify({
      success: true,
      selector: '#menu',
      tagName: 'div',
      text: 'Menu',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: successResult }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerClick } = await import('../../../src/commands/interact/click.js');
    const program = new Command();
    program.exitOverride();
    registerClick(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'click', '#menu', '--json', '--port', '9999', '--token', 'tok']);

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    expect(output.success).toBe(true);
    expect(output.tagName).toBe('div');
    expect(output.text).toBe('Menu');
  });

  it('throws when element not found', async () => {
    const failResult = JSON.stringify({
      success: false,
      selector: '#gone',
      error: 'Element not found',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: failResult }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerClick } = await import('../../../src/commands/interact/click.js');
    const program = new Command();
    program.exitOverride();
    registerClick(program);

    await expect(
      program.parseAsync(['node', 'test', 'click', '#gone', '--port', '9999', '--token', 'tok']),
    ).rejects.toThrow('Click failed: Element not found');

    vi.unstubAllGlobals();
  });

  it('says right-clicked for --right flag', async () => {
    const successResult = JSON.stringify({
      success: true,
      selector: '.item',
      tagName: 'li',
      text: 'List Item',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: successResult }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerClick } = await import('../../../src/commands/interact/click.js');
    const program = new Command();
    program.exitOverride();
    registerClick(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'click', '.item', '--right', '--port', '9999', '--token', 'tok']);

    const output = logSpy.mock.calls[0][0] as string;
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    expect(output).toContain('right-clicked');
  });

  it('says double-clicked for --double flag', async () => {
    const successResult = JSON.stringify({
      success: true,
      selector: '.row',
      tagName: 'tr',
      text: '',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: successResult }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerClick } = await import('../../../src/commands/interact/click.js');
    const program = new Command();
    program.exitOverride();
    registerClick(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'click', '.row', '--double', '--port', '9999', '--token', 'tok']);

    const output = logSpy.mock.calls[0][0] as string;
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    expect(output).toContain('double-clicked');
  });
});
