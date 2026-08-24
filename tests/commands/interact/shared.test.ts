import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Command } from 'commander';
import {
  escapeSelector,
  buildFindElementScript,
  buildWaitAndFindScript,
  addInteractOptions,
  addVerifyOptions,
  buildSetValueScript,
  parseInteractResult,
  resolveVerifyTimeout,
  DEFAULT_VERIFY_TIMEOUT_MS,
  MAX_VERIFY_TIMEOUT_MS,
  NATIVE_VALUE_WRITER_SNIPPET,
  VERIFY_POLL_SNIPPET,
} from '../../../src/commands/interact/shared.js';

describe('interact/shared', () => {
  describe('escapeSelector', () => {
    it('returns simple selectors unchanged', () => {
      expect(escapeSelector('#app')).toBe('#app');
      expect(escapeSelector('.btn')).toBe('.btn');
      expect(escapeSelector('div > span')).toBe('div > span');
    });

    it('escapes backslashes', () => {
      expect(escapeSelector('div\\:hover')).toBe('div\\\\:hover');
    });

    it('escapes single quotes', () => {
      expect(escapeSelector("[data-name='foo']")).toBe("[data-name=\\'foo\\']");
    });

    it('escapes both backslashes and single quotes together', () => {
      expect(escapeSelector("a\\'b")).toBe("a\\\\\\'b");
    });
  });

  describe('buildFindElementScript', () => {
    it('contains querySelector call with the selector', () => {
      const script = buildFindElementScript('#submit');
      expect(script).toContain("document.querySelector('#submit')");
    });

    it('returns JSON with found: false when element missing', () => {
      const script = buildFindElementScript('.missing');
      expect(script).toContain('{ found: false }');
    });

    it('returns JSON with found: true, tagName, id, and text', () => {
      const script = buildFindElementScript('button');
      expect(script).toContain('found: true');
      expect(script).toContain('tagName: el.tagName.toLowerCase()');
      expect(script).toContain('id: el.id');
      expect(script).toContain('text:');
    });

    it('truncates text to 100 characters', () => {
      const script = buildFindElementScript('p');
      expect(script).toContain('.slice(0, 100)');
    });

    it('is an IIFE (immediately invoked function expression)', () => {
      const script = buildFindElementScript('div');
      expect(script).toMatch(/^\(\(\) => \{/);
      expect(script).toMatch(/\}\)\(\)$/);
    });

    it('escapes selectors with special characters', () => {
      const script = buildFindElementScript("[data-id='test']");
      expect(script).toContain("document.querySelector('[data-id=\\'test\\']')");
    });
  });

  describe('buildWaitAndFindScript', () => {
    it('delegates to buildFindElementScript when waitMs is 0', () => {
      const script = buildWaitAndFindScript('.btn', 0);
      const directScript = buildFindElementScript('.btn');
      expect(script).toBe(directScript);
    });

    it('delegates to buildFindElementScript when waitMs is negative', () => {
      const script = buildWaitAndFindScript('.btn', -100);
      const directScript = buildFindElementScript('.btn');
      expect(script).toBe(directScript);
    });

    it('returns a Promise when waitMs > 0', () => {
      const script = buildWaitAndFindScript('.btn', 2000);
      expect(script).toContain('new Promise');
    });

    it('uses the specified timeout value', () => {
      const script = buildWaitAndFindScript('.btn', 5000);
      expect(script).toContain('Date.now() + 5000');
    });

    it('polls every 100ms', () => {
      const script = buildWaitAndFindScript('.btn', 1000);
      expect(script).toContain('setTimeout(poll, 100)');
    });

    it('contains querySelector call with the selector', () => {
      const script = buildWaitAndFindScript('#loader', 3000);
      expect(script).toContain("document.querySelector('#loader')");
    });

    it('returns found: false on timeout', () => {
      const script = buildWaitAndFindScript('.late', 500);
      expect(script).toContain('{ found: false }');
    });

    it('returns found: true with element details when element appears', () => {
      const script = buildWaitAndFindScript('.item', 1000);
      expect(script).toContain('found: true');
      expect(script).toContain('tagName: el.tagName.toLowerCase()');
    });

    it('escapes selectors with special characters', () => {
      const script = buildWaitAndFindScript("[name='email']", 2000);
      expect(script).toContain("document.querySelector('[name=\\'email\\']')");
    });

    it('truncates text to 100 characters in polling script', () => {
      const script = buildWaitAndFindScript('p', 1000);
      expect(script).toContain('.slice(0, 100)');
    });
  });

  describe('addInteractOptions', () => {
    it('adds --port, --token, and --json options', async () => {
      const { Command } = await import('commander');
      const cmd = new Command('test-interact');

      addInteractOptions(cmd);

      const portOpt = cmd.options.find((o) => o.long === '--port');
      const tokenOpt = cmd.options.find((o) => o.long === '--token');
      const jsonOpt = cmd.options.find((o) => o.long === '--json');

      expect(portOpt).toBeDefined();
      expect(tokenOpt).toBeDefined();
      expect(jsonOpt).toBeDefined();
    });

    it('returns the command for chaining', async () => {
      const { Command } = await import('commander');
      const cmd = new Command('test-chain');

      const result = addInteractOptions(cmd);
      expect(result).toBe(cmd);
    });
  });
});

describe('interact/shared value writing + verification', () => {
  /** Evaluates a script snippet in node (no DOM) and returns the named function it defines. */
  const load = <T>(snippet: string, name: string): T => new Function(`${snippet}; return ${name};`)() as T;

  describe('__resolveValueWriter', () => {
    type Writer = { kind: string; set: (v: string) => void } | null;
    const resolve = load<(node: object) => Writer>(NATIVE_VALUE_WRITER_SNIPPET, '__resolveValueWriter');

    it('uses a prototype accessor on custom elements, bypassing a React-style instance override', () => {
      const calls: string[] = [];
      class FancyInput {
        get value() {
          return '';
        }
        set value(v: string) {
          calls.push('proto:' + v);
        }
      }
      const node = Object.assign(new FancyInput(), { tagName: 'FANCY-INPUT', localName: 'fancy-input' });
      Object.defineProperty(node, 'value', {
        configurable: true,
        get: () => '',
        set: (v: string) => calls.push('instance:' + v),
      });
      const writer = resolve(node);
      expect(writer?.kind).toBe('custom');
      writer!.set('x');
      expect(calls).toEqual(['proto:x']);
    });

    it('walks up the chain for subclasses without their own accessor', () => {
      const calls: string[] = [];
      class Base {
        get value() {
          return '';
        }
        set value(v: string) {
          calls.push(v);
        }
      }
      class Sub extends Base {}
      const node = Object.assign(new Sub(), { tagName: 'X-SUB', localName: 'x-sub' });
      const writer = resolve(node);
      expect(writer?.kind).toBe('custom');
      writer!.set('y');
      expect(calls).toEqual(['y']);
    });

    it('falls back to assignment for a plain data property', () => {
      const node: { tagName: string; localName: string; value: string } = { tagName: 'X-FIELD', localName: 'x-field', value: '' };
      const writer = resolve(node);
      expect(writer?.kind).toBe('assign');
      writer!.set('z');
      expect(node.value).toBe('z');
    });

    it('returns null for elements without a value setter', () => {
      expect(resolve({ tagName: 'DIV', localName: 'div' })).toBeNull();
      expect(resolve({ tagName: 'X-EMPTY', localName: 'x-empty' })).toBeNull();
    });
  });

  describe('__verify', () => {
    type Verify = (read: () => unknown, expected: unknown, timeoutMs: number, intervalMs: number) => Promise<{ ok: boolean; observed: unknown }>;
    const verify = load<Verify>(VERIFY_POLL_SNIPPET, '__verify');

    it('resolves on the first (synchronous) matching read without scheduling a timer', async () => {
      vi.useFakeTimers();
      try {
        const read = vi.fn(() => 'x');
        const p = verify(read, 'x', 500, 50);
        expect(vi.getTimerCount()).toBe(0);
        await expect(p).resolves.toEqual({ ok: true, observed: 'x' });
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps polling until the value matches', async () => {
      vi.useFakeTimers();
      try {
        let current = 'old';
        const p = verify(() => current, 'new', 500, 50);
        await vi.advanceTimersByTimeAsync(120);
        current = 'new';
        await vi.advanceTimersByTimeAsync(50);
        await expect(p).resolves.toEqual({ ok: true, observed: 'new' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves ok:false with the last observed value at the deadline', async () => {
      vi.useFakeTimers();
      try {
        const p = verify(() => 'old', 'new', 200, 50);
        await vi.advanceTimersByTimeAsync(250);
        await expect(p).resolves.toEqual({ ok: false, observed: 'old' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports observed undefined when read throws, and timeoutMs 0 performs exactly one read', async () => {
      const throwing = vi.fn(() => {
        throw new Error('gone');
      });
      await expect(verify(throwing, 'x', 0, 50)).resolves.toEqual({ ok: false, observed: undefined });
      expect(throwing).toHaveBeenCalledTimes(1);
      const read = vi.fn(() => 'a');
      await expect(verify(read, 'b', 0, 50)).resolves.toEqual({ ok: false, observed: 'a' });
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveVerifyTimeout', () => {
    it('defaults to DEFAULT_VERIFY_TIMEOUT_MS', () => {
      expect(resolveVerifyTimeout()).toBe(DEFAULT_VERIFY_TIMEOUT_MS);
      expect(resolveVerifyTimeout({})).toBe(500);
    });

    it('accepts the bounds', () => {
      expect(resolveVerifyTimeout({ verifyTimeoutMs: 0 })).toBe(0);
      expect(resolveVerifyTimeout({ verifyTimeoutMs: MAX_VERIFY_TIMEOUT_MS })).toBe(4000);
    });

    it.each([-1, 4001, 1.5, NaN])('rejects %p', (ms) => {
      expect(() => resolveVerifyTimeout({ verifyTimeoutMs: ms })).toThrow(/--verify-timeout must be an integer between 0 and 4000 ms/);
    });
  });

  describe('addVerifyOptions', () => {
    it('registers --verify-timeout with the default deadline', () => {
      const cmd = new Command('x');
      expect(addVerifyOptions(cmd)).toBe(cmd);
      const opt = cmd.options.find((o) => o.long === '--verify-timeout');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe(500);
      cmd.parse(['node', 'x', '--verify-timeout', '250']);
      expect(cmd.opts().verifyTimeout).toBe(250);
    });
  });

  describe('parseInteractResult', () => {
    const schema = z.object({ success: z.boolean() });

    it('surfaces a bridge ERROR: payload as an actionable error', () => {
      expect(() => parseInteractResult('ERROR: boom', schema, 'Type')).toThrow('Type failed: the bridge script threw: boom');
    });

    it('surfaces non-JSON results', () => {
      expect(() => parseInteractResult('not json', schema, 'Select')).toThrow('Select failed: bridge returned a non-JSON result: not json');
      expect(() => parseInteractResult(null, schema, 'Type')).toThrow(/non-JSON result/);
    });

    it('validates JSON through the schema', () => {
      expect(parseInteractResult('{"success":true}', schema, 'Type')).toEqual({ success: true });
      expect(() => parseInteractResult('{"success":"yes"}', schema, 'Type')).toThrow();
    });
  });

  describe('buildSetValueScript', () => {
    const base = { focus: false, clear: false, lowerCaseTagName: false, notFoundErrorExpr: `'nope'`, verifyTimeoutMs: 100 };

    it('honours focus/clear/tagName/not-found options', () => {
      const plain = buildSetValueScript('#a', 'v', base);
      expect(plain).not.toContain('el.focus()');
      expect(plain).not.toContain("writer.set('')");
      expect(plain).toContain('var tagName = el.tagName;');
      expect(plain).toContain("return fail({ error: 'nope' });");
      expect(plain).toContain(', 100, 50)');
      expect(plain).toContain('__settle().then(');

      const full = buildSetValueScript('#a', 'v', { ...base, focus: true, clear: true, lowerCaseTagName: true });
      expect(full).toContain("if (typeof el.focus === 'function') el.focus();");
      expect(full).toContain("writer.set('')");
      expect(full).toContain('var tagName = el.tagName.toLowerCase();');
    });

    it('embeds the value as JSON and the selector escaped', () => {
      const script = buildSetValueScript("[data-x='1']", 'a"b\nc', base);
      expect(script).toContain("var selector = '[data-x=\\'1\\']';");
      expect(script).toContain('var requested = "a\\"b\\nc";');
    });
  });
});
