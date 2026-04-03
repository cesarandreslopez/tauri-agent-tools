import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { buildScrollScript, registerScroll } from '../../../src/commands/interact/scroll.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('buildScrollScript', () => {
  describe('window scroll (no selector)', () => {
    it('uses scrollBy on window when --by is provided', () => {
      const script = buildScrollScript({ by: 200 });
      expect(script).toContain('window.scrollBy(0, 200)');
      expect(script).toContain('window.scrollX');
      expect(script).toContain('window.scrollY');
    });

    it('uses scrollTo on window when --to is provided', () => {
      const script = buildScrollScript({ to: 500 });
      expect(script).toContain('window.scrollTo(0, 500)');
    });

    it('scrolls to top when --to-top is set', () => {
      const script = buildScrollScript({ toTop: true });
      expect(script).toContain('window.scrollTo(0, 0)');
    });

    it('scrolls to bottom when --to-bottom is set', () => {
      const script = buildScrollScript({ toBottom: true });
      expect(script).toContain('document.documentElement.scrollHeight');
      expect(script).toContain('window.scrollTo');
    });

    it('returns success JSON with scrollX and scrollY', () => {
      const script = buildScrollScript({ by: 100 });
      expect(script).toContain('success: true');
      expect(script).toContain('window.scrollX');
      expect(script).toContain('window.scrollY');
    });

    it('wraps in IIFE', () => {
      const script = buildScrollScript({ by: 10 });
      expect(script.trim()).toMatch(/^\(function\(\)/);
      expect(script).toContain('})()');
    });
  });

  describe('element scroll (with selector)', () => {
    it('uses scrollBy on element when selector + by', () => {
      const script = buildScrollScript({ selector: '.panel', by: 100 });
      expect(script).toContain("document.querySelector('.panel')");
      expect(script).toContain('el.scrollBy(0, 100)');
      expect(script).toContain('el.scrollLeft');
      expect(script).toContain('el.scrollTop');
    });

    it('uses scrollTo on element when selector + to', () => {
      const script = buildScrollScript({ selector: '#list', to: 300 });
      expect(script).toContain("document.querySelector('#list')");
      expect(script).toContain('el.scrollTo(0, 300)');
    });

    it('scrolls element to top when selector + toTop', () => {
      const script = buildScrollScript({ selector: '.box', toTop: true });
      expect(script).toContain('el.scrollTo(0, 0)');
    });

    it('scrolls element to bottom when selector + toBottom', () => {
      const script = buildScrollScript({ selector: '.box', toBottom: true });
      expect(script).toContain('el.scrollHeight');
      expect(script).toContain('el.scrollTo');
    });

    it('returns error when element not found', () => {
      const script = buildScrollScript({ selector: '.missing', by: 100 });
      expect(script).toContain('Element not found');
    });
  });

  describe('scrollIntoView (selector + intoView)', () => {
    it('calls scrollIntoView with smooth behavior and center block', () => {
      const script = buildScrollScript({ selector: '.target', intoView: true });
      expect(script).toContain("document.querySelector('.target')");
      expect(script).toContain("scrollIntoView({ behavior: 'smooth', block: 'center' })");
    });

    it('returns window scroll coordinates', () => {
      const script = buildScrollScript({ selector: '.target', intoView: true });
      expect(script).toContain('window.scrollX');
      expect(script).toContain('window.scrollY');
    });

    it('returns error when element not found', () => {
      const script = buildScrollScript({ selector: '.missing', intoView: true });
      expect(script).toContain('Element not found');
    });
  });

  describe('selector escaping', () => {
    it('escapes single quotes in selector', () => {
      const script = buildScrollScript({ selector: "input[name='foo']", by: 10 });
      expect(script).toContain("input[name=\\'foo\\']");
    });
  });
});

describe('registerScroll', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScroll(program);
    return program;
  }

  it('registers scroll command', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'scroll');
    expect(cmd).toBeDefined();
  });

  it('has expected options', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'scroll')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--selector');
    expect(optionNames).toContain('--by');
    expect(optionNames).toContain('--to');
    expect(optionNames).toContain('--to-top');
    expect(optionNames).toContain('--to-bottom');
    expect(optionNames).toContain('--into-view');
    expect(optionNames).toContain('--port');
    expect(optionNames).toContain('--token');
  });
});
