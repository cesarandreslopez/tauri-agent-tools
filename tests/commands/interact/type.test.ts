import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTypeScript } from '../../../src/commands/interact/type.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test-token', pid: 12345 }),
}));

describe('buildTypeScript', () => {
  it('generates a script with querySelector for the given selector', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("document.querySelector('#username')");
  });

  it('generates a script that focuses the element', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain('el.focus()');
  });

  it('sets el.value to the provided text', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain('el.value = "hello"');
  });

  it('dispatches input event with bubbles: true', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("new Event('input', { bubbles: true })");
  });

  it('dispatches change event with bubbles: true', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script).toContain("new Event('change', { bubbles: true })");
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

  it('wraps in an IIFE', () => {
    const script = buildTypeScript('#username', 'hello', false);
    expect(script.trim()).toMatch(/^\(\(\) =>/);
    expect(script.trim()).toMatch(/\)\(\)$/);
  });

  describe('clear option', () => {
    it('includes select and value reset when clear is true', () => {
      const script = buildTypeScript('#username', 'hello', true);
      expect(script).toContain('el.select()');
      expect(script).toContain("el.value = ''");
    });

    it('dispatches input event after clearing', () => {
      const script = buildTypeScript('#username', 'hello', true);
      // There should be two input event dispatches: one for clear, one for type
      const inputEventCount = (script.match(/new Event\('input'/g) ?? []).length;
      expect(inputEventCount).toBe(2);
    });

    it('does not include select when clear is false', () => {
      const script = buildTypeScript('#username', 'hello', false);
      expect(script).not.toContain('el.select()');
    });
  });

  describe('special characters in text', () => {
    it('safely embeds text with double quotes using JSON.stringify', () => {
      const script = buildTypeScript('#input', 'say "hello"', false);
      // JSON.stringify will escape the quotes
      expect(script).toContain('"say \\"hello\\""');
    });

    it('safely embeds text with single quotes', () => {
      const script = buildTypeScript('#input', "it's alive", false);
      expect(script).toContain("it's alive");
      // Single quotes inside JSON string are fine without escaping
      const valueMatch = script.match(/el\.value = (.+);/);
      expect(valueMatch).not.toBeNull();
      // The value should be valid JSON
      if (valueMatch) {
        expect(() => JSON.parse(valueMatch[1]!)).not.toThrow();
      }
    });

    it('safely embeds text with backslashes', () => {
      const script = buildTypeScript('#input', 'path\\to\\file', false);
      // JSON.stringify escapes backslashes
      const valueMatch = script.match(/el\.value = (.+);/);
      expect(valueMatch).not.toBeNull();
      if (valueMatch) {
        const parsed = JSON.parse(valueMatch[1]!);
        expect(parsed).toBe('path\\to\\file');
      }
    });

    it('safely embeds text with newlines', () => {
      const script = buildTypeScript('#textarea', 'line1\nline2', false);
      const valueMatch = script.match(/el\.value = (.+);/);
      expect(valueMatch).not.toBeNull();
      if (valueMatch) {
        const parsed = JSON.parse(valueMatch[1]!);
        expect(parsed).toBe('line1\nline2');
      }
    });

    it('safely handles empty string', () => {
      const script = buildTypeScript('#input', '', false);
      expect(script).toContain('el.value = ""');
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
  });

  it('types text and prints human-readable output', async () => {
    const resultPayload = {
      success: true,
      selector: '#username',
      tagName: 'INPUT',
      value: 'admin',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: JSON.stringify(resultPayload) }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerType } = await import('../../../src/commands/interact/type.js');
    const program = new Command();
    registerType(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'type', '#username', 'admin']);

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain('input');
    expect(output).toContain('admin');

    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('outputs JSON when --json flag is set', async () => {
    const resultPayload = {
      success: true,
      selector: '#email',
      tagName: 'INPUT',
      value: 'user@example.com',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: JSON.stringify(resultPayload) }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerType } = await import('../../../src/commands/interact/type.js');
    const program = new Command();
    registerType(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'type', '#email', 'user@example.com', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    logSpy.mockRestore();
    vi.unstubAllGlobals();

    expect(output.success).toBe(true);
    expect(output.value).toBe('user@example.com');
    expect(output.tagName).toBe('INPUT');
  });

  it('throws when element not found', async () => {
    const resultPayload = {
      success: false,
      selector: '#missing',
      error: 'Element not found',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: JSON.stringify(resultPayload) }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerType } = await import('../../../src/commands/interact/type.js');
    const program = new Command();
    program.exitOverride();
    registerType(program);

    await expect(
      program.parseAsync(['node', 'test', 'type', '#missing', 'hello']),
    ).rejects.toThrow('Type failed: Element not found');

    vi.unstubAllGlobals();
  });

  it('passes --clear option to the generated script', async () => {
    const resultPayload = {
      success: true,
      selector: '#search',
      tagName: 'INPUT',
      value: 'new text',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: JSON.stringify(resultPayload) }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { Command } = await import('commander');
    const { registerType } = await import('../../../src/commands/interact/type.js');
    const program = new Command();
    registerType(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'type', '#search', 'new text', '--clear']);
    logSpy.mockRestore();

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.js).toContain('el.select()');
    expect(body.js).toContain("el.value = ''");

    vi.unstubAllGlobals();
  });
});
