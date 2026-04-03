import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { buildNavigateScript, registerNavigate } from '../../../src/commands/interact/navigate.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('buildNavigateScript', () => {
  describe('path navigation (starts with /)', () => {
    it('uses history.pushState for paths starting with /', () => {
      const script = buildNavigateScript('/dashboard');
      expect(script).toContain("window.history.pushState({}, '', '/dashboard')");
    });

    it('dispatches popstate event after pushState', () => {
      const script = buildNavigateScript('/settings');
      expect(script).toContain("window.dispatchEvent(new PopStateEvent('popstate'");
    });

    it('returns success with tagName window and selector as path', () => {
      const script = buildNavigateScript('/home');
      expect(script).toContain('success: true');
      expect(script).toContain("'window'");
      expect(script).toContain("'/home'");
    });

    it('wraps in IIFE', () => {
      const script = buildNavigateScript('/path');
      expect(script.trim()).toMatch(/^\(function\(\)/);
      expect(script).toContain('})()');
    });
  });

  describe('URL navigation (does not start with /)', () => {
    it('uses window.location.href for full URLs', () => {
      const script = buildNavigateScript('https://example.com');
      expect(script).toContain("window.location.href = 'https://example.com'");
    });

    it('does not use pushState for full URLs', () => {
      const script = buildNavigateScript('https://example.com');
      expect(script).not.toContain('pushState');
    });

    it('returns success JSON with tagName and selector', () => {
      const script = buildNavigateScript('https://example.com/page');
      expect(script).toContain('success: true');
      expect(script).toContain("'window'");
    });

    it('catches errors and returns error JSON', () => {
      const script = buildNavigateScript('https://example.com');
      expect(script).toContain('catch (e)');
      expect(script).toContain('String(e)');
    });
  });

  describe('selector/URL escaping', () => {
    it('escapes single quotes in path', () => {
      // Edge case: path with apostrophe
      const script = buildNavigateScript("/user's-profile");
      expect(script).toContain("/user\\'s-profile");
    });
  });
});

describe('registerNavigate', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerNavigate(program);
    return program;
  }

  it('registers navigate command', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'navigate');
    expect(cmd).toBeDefined();
  });

  it('has target argument', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'navigate')!;
    expect(cmd.registeredArguments.length).toBe(1);
    expect(cmd.registeredArguments[0]?.name()).toBe('target');
  });

  it('has bridge options', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'navigate')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--port');
    expect(optionNames).toContain('--token');
  });

  it('has expected description', () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === 'navigate')!;
    expect(cmd.description()).toBe('Navigate to a URL or path');
  });
});
