import { describe, it, expect, vi } from 'vitest';
import { buildInvokeScript } from '../../src/commands/invoke.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('invoke command', () => {
  describe('buildInvokeScript', () => {
    it('generates a script that calls window.__TAURI__.core.invoke', () => {
      const script = buildInvokeScript('my_command', {});
      expect(script).toContain('window.__TAURI__.core.invoke');
      expect(script).toContain('"my_command"');
    });

    it('uses async IIFE pattern', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toMatch(/^\(async \(\) => \{/);
      expect(script).toContain('})()');
    });

    it('checks for window.__TAURI__ and window.__TAURI__.core', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toContain('window.__TAURI__');
      expect(script).toContain('window.__TAURI__.core');
    });

    it('returns error JSON when __TAURI__ is missing', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toContain('window.__TAURI__.core not found');
      expect(script).toContain('success: false');
    });

    it('serializes args correctly', () => {
      const args = { id: 42, name: 'test' };
      const script = buildInvokeScript('get_user', args);
      expect(script).toContain(JSON.stringify(args));
    });

    it('defaults args to {} when called with empty object', () => {
      const script = buildInvokeScript('ping', {});
      expect(script).toContain('{}');
    });

    it('works without args (defaults to {})', () => {
      const script = buildInvokeScript('ping', {});
      expect(script).toContain('"ping"');
      expect(script).toContain('{}');
    });

    it('returns success JSON on successful invoke', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toContain('success: true');
      expect(script).toContain('result: result');
    });

    it('catches errors and returns failure JSON', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toContain('catch (e)');
      expect(script).toContain('success: false');
      expect(script).toContain('e.message');
    });

    it('safely embeds command name via JSON.stringify', () => {
      const commandWithSpecialChars = 'my-command_v2';
      const script = buildInvokeScript(commandWithSpecialChars, {});
      expect(script).toContain(JSON.stringify(commandWithSpecialChars));
    });

    it('handles complex nested args', () => {
      const args = { filters: ['a', 'b'], options: { limit: 10 } };
      const script = buildInvokeScript('search', args);
      expect(script).toContain(JSON.stringify(args));
    });

    it('handles null args', () => {
      const script = buildInvokeScript('reset', null);
      expect(script).toContain('null');
    });
  });
});
