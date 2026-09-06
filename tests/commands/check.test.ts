import { describe, it, expect, vi } from 'vitest';
import { buildSelectorCheck, buildEvalCheck, buildTextCheck } from '../../src/commands/check.js';
import { CheckItemSchema, CheckResultSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('check command', () => {
  describe('selector literal encoding', () => {
    it.each(['#app', '.my-button', 'div > p.text', "input[name='email']", 'div\\nspan', 'div\nspan'])('preserves %s', selector => {
      const querySelector=vi.fn().mockReturnValue({});
      expect(new Function('document', `return ${buildSelectorCheck(selector)}`)({querySelector})).toBe(true);
      expect(querySelector).toHaveBeenCalledWith(selector);
    });
    it('leaves promise evaluation to the awaiting evaluator', () => {
      expect(buildEvalCheck('Promise.resolve(false)')).toBe('Promise.resolve(false)');
    });
  });

  describe('text literal encoding', () => {
    it.each(['Hello World', "it's done", 'path\\to\\file', 'first\nsecond'])('preserves %s', pattern => {
      const includes = vi.fn().mockReturnValue(true);
      expect(new Function('document', `return ${buildTextCheck(pattern)}`)({body: {textContent: {includes}}})).toBe(true);
      expect(includes).toHaveBeenCalledWith(pattern);
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
