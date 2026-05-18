import { describe, it, expect, vi } from 'vitest';
import { buildInvokeScript } from '../../src/commands/invoke.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('invoke command', () => {
  describe('buildInvokeScript', () => {
    function runInvokeScript(script: string, windowObj: unknown): Promise<string> {
      return new Function('window', `return ${script};`)(windowObj) as Promise<string>;
    }

    it('generates a script that prefers window.__TAURI_INTERNALS__.invoke', () => {
      const script = buildInvokeScript('my_command', {});
      const internals = script.indexOf('window.__TAURI_INTERNALS__.invoke');
      const global = script.indexOf('window.__TAURI__.core.invoke');

      expect(internals).toBeGreaterThanOrEqual(0);
      expect(global).toBeGreaterThanOrEqual(0);
      expect(internals).toBeLessThan(global);
      expect(script).toContain('"my_command"');
    });

    it('uses async IIFE pattern', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toMatch(/^\(async \(\) => \{/);
      expect(script).toContain('})()');
    });

    it('keeps window.__TAURI__.core.invoke as a fallback', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toContain('window.__TAURI_INTERNALS__');
      expect(script).toContain('window.__TAURI__');
      expect(script).toContain('window.__TAURI__.core');
    });

    it('returns error JSON when no Tauri invoke API is available', () => {
      const script = buildInvokeScript('cmd', {});
      expect(script).toContain('Tauri invoke API not found');
      expect(script).toContain('success: false');
    });

    it('calls __TAURI_INTERNALS__.invoke when the global Tauri API is disabled', async () => {
      const invoke = vi.fn().mockResolvedValue({ ok: true });
      const script = buildInvokeScript('cmd', { id: 1 });
      const raw = await runInvokeScript(script, {
        __TAURI_INTERNALS__: { invoke },
      });

      expect(invoke).toHaveBeenCalledWith('cmd', { id: 1 });
      expect(JSON.parse(raw)).toEqual({
        success: true,
        command: 'cmd',
        result: { ok: true },
      });
    });

    it('falls back to window.__TAURI__.core.invoke', async () => {
      const invoke = vi.fn().mockResolvedValue('ok');
      const script = buildInvokeScript('cmd', {});
      const raw = await runInvokeScript(script, {
        __TAURI__: { core: { invoke } },
      });

      expect(invoke).toHaveBeenCalledWith('cmd', {});
      expect(JSON.parse(raw)).toEqual({
        success: true,
        command: 'cmd',
        result: 'ok',
      });
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
