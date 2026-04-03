import { describe, it, expect } from 'vitest';
import {
  escapeSelector,
  buildFindElementScript,
  buildWaitAndFindScript,
  addInteractOptions,
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
