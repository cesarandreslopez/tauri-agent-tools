import { describe, it, expect, vi } from 'vitest';
import { buildSelectorCheck, buildEvalCheck, buildTextCheck } from '../../src/commands/check.js';
import { CheckItemSchema, CheckResultSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('check command', () => {
  describe('buildSelectorCheck', () => {
    it('generates correct querySelector JS for a simple selector', () => {
      const js = buildSelectorCheck('#app');
      expect(js).toBe("!!document.querySelector('#app')");
    });

    it('generates correct querySelector JS for a class selector', () => {
      const js = buildSelectorCheck('.my-button');
      expect(js).toBe("!!document.querySelector('.my-button')");
    });

    it('generates correct querySelector JS for a complex selector', () => {
      const js = buildSelectorCheck('div > p.text');
      expect(js).toBe("!!document.querySelector('div > p.text')");
    });

    it('escapes single quotes in the selector', () => {
      const js = buildSelectorCheck("input[name='email']");
      expect(js).toBe("!!document.querySelector('input[name=\\'email\\']')");
    });

    it('escapes backslashes in the selector', () => {
      const js = buildSelectorCheck('div\\nspan');
      expect(js).toBe("!!document.querySelector('div\\\\nspan')");
    });

    it('returns a string starting with !!document.querySelector', () => {
      const js = buildSelectorCheck('button');
      expect(js).toMatch(/^!!document\.querySelector\(/);
    });
  });

  describe('buildEvalCheck', () => {
    it('generates correct truthy check JS for a simple expression', () => {
      const js = buildEvalCheck('window.myFlag');
      expect(js).toBe('!!(window.myFlag)');
    });

    it('generates correct truthy check JS for a comparison expression', () => {
      const js = buildEvalCheck('document.querySelectorAll("li").length > 0');
      expect(js).toBe('!!(document.querySelectorAll("li").length > 0)');
    });

    it('wraps expression in !!()', () => {
      const js = buildEvalCheck('1 + 1 === 2');
      expect(js).toBe('!!(1 + 1 === 2)');
    });

    it('handles function call expressions', () => {
      const js = buildEvalCheck('window.checkReady()');
      expect(js).toBe('!!(window.checkReady())');
    });
  });

  describe('buildTextCheck', () => {
    it('generates correct textContent check JS', () => {
      const js = buildTextCheck('Hello World');
      expect(js).toBe("document.body.textContent.includes('Hello World')");
    });

    it('generates correct check for simple text pattern', () => {
      const js = buildTextCheck('Welcome');
      expect(js).toBe("document.body.textContent.includes('Welcome')");
    });

    it('escapes single quotes in the pattern', () => {
      const js = buildTextCheck("it's done");
      expect(js).toBe("document.body.textContent.includes('it\\'s done')");
    });

    it('escapes backslashes in the pattern', () => {
      const js = buildTextCheck('path\\to\\file');
      expect(js).toBe("document.body.textContent.includes('path\\\\to\\\\file')");
    });

    it('returns a string using document.body.textContent.includes', () => {
      const js = buildTextCheck('any text');
      expect(js).toMatch(/^document\.body\.textContent\.includes\(/);
    });
  });

  describe('CheckItemSchema', () => {
    it('validates a passing selector check', () => {
      const item = {
        type: 'selector',
        passed: true,
        selector: '#app',
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('selector');
        expect(result.data.passed).toBe(true);
        expect(result.data.selector).toBe('#app');
      }
    });

    it('validates a failing eval check with error', () => {
      const item = {
        type: 'eval',
        passed: false,
        expression: 'window.missing',
        error: 'bridge timeout',
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('eval');
        expect(result.data.passed).toBe(false);
        expect(result.data.expression).toBe('window.missing');
        expect(result.data.error).toBe('bridge timeout');
      }
    });

    it('validates a passing no-errors check', () => {
      const item = {
        type: 'no-errors',
        passed: true,
        errors: [],
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.errors).toEqual([]);
      }
    });

    it('validates a failing no-errors check with captured errors', () => {
      const item = {
        type: 'no-errors',
        passed: false,
        errors: ['Uncaught TypeError: Cannot read property', 'Failed to fetch'],
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.passed).toBe(false);
        expect(result.data.errors).toHaveLength(2);
      }
    });

    it('validates a passing text check', () => {
      const item = {
        type: 'text',
        passed: true,
        pattern: 'Welcome',
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });

    it('rejects unknown check types', () => {
      const item = {
        type: 'unknown-type',
        passed: true,
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });

    it('requires passed field', () => {
      const item = {
        type: 'selector',
        selector: '#app',
      };
      const result = CheckItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });
  });

  describe('CheckResultSchema', () => {
    it('validates a fully passing result', () => {
      const result = {
        passed: true,
        checks: [
          { type: 'selector', passed: true, selector: '#app' },
          { type: 'eval', passed: true, expression: 'window.ready' },
        ],
      };
      const parsed = CheckResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.passed).toBe(true);
        expect(parsed.data.checks).toHaveLength(2);
      }
    });

    it('validates a failing result', () => {
      const result = {
        passed: false,
        checks: [
          { type: 'selector', passed: true, selector: '#app' },
          { type: 'text', passed: false, pattern: 'Missing text' },
        ],
      };
      const parsed = CheckResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.passed).toBe(false);
        expect(parsed.data.checks[1]?.passed).toBe(false);
      }
    });

    it('validates an empty checks array', () => {
      const result = {
        passed: true,
        checks: [],
      };
      const parsed = CheckResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it('requires checks array', () => {
      const result = {
        passed: true,
      };
      const parsed = CheckResultSchema.safeParse(result);
      expect(parsed.success).toBe(false);
    });
  });
});
