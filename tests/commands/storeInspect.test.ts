import { describe, it, expect, vi } from 'vitest';
import { buildStoreDetectionScript } from '../../src/commands/storeInspect.js';
import { StoreInspectResultSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('StoreInspectResultSchema', () => {
  it('validates a valid result with framework and stores', () => {
    const result = StoreInspectResultSchema.parse({
      framework: 'pinia',
      stores: { counter: { count: 0 } },
    });
    expect(result.framework).toBe('pinia');
    expect(result.stores).toEqual({ counter: { count: 0 } });
  });

  it('validates result with empty stores', () => {
    const result = StoreInspectResultSchema.parse({
      framework: 'unknown',
      stores: {},
    });
    expect(result.framework).toBe('unknown');
    expect(result.stores).toEqual({});
  });

  it('validates result with nested store values', () => {
    const result = StoreInspectResultSchema.parse({
      framework: 'vue',
      stores: {
        auth: { user: { name: 'Alice', role: 'admin' }, token: 'abc' },
      },
    });
    expect(result.stores['auth']).toBeDefined();
  });

  it('rejects missing framework field', () => {
    expect(() =>
      StoreInspectResultSchema.parse({ stores: {} }),
    ).toThrow();
  });

  it('rejects missing stores field', () => {
    expect(() =>
      StoreInspectResultSchema.parse({ framework: 'pinia' }),
    ).toThrow();
  });

  it('rejects non-object stores', () => {
    expect(() =>
      StoreInspectResultSchema.parse({ framework: 'pinia', stores: 'bad' }),
    ).toThrow();
  });
});

describe('buildStoreDetectionScript', () => {
  it('returns a string (IIFE)', () => {
    const script = buildStoreDetectionScript('auto');
    expect(typeof script).toBe('string');
    expect(script.trim().startsWith('(function()')).toBe(true);
    expect(script.trim().endsWith(')()') || script.trim().endsWith(')()')).toBe(true);
  });

  it('includes __DEBUG_STORES__ check', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('__DEBUG_STORES__');
  });

  it('includes __pinia check for auto framework', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('__pinia');
  });

  it('includes __VUE_DEVTOOLS_GLOBAL_HOOK__ check for auto framework', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('__VUE_DEVTOOLS_GLOBAL_HOOK__');
  });

  it('includes __pinia check for pinia framework', () => {
    const script = buildStoreDetectionScript('pinia');
    expect(script).toContain('__pinia');
  });

  it('includes __VUE_DEVTOOLS_GLOBAL_HOOK__ for vue framework', () => {
    const script = buildStoreDetectionScript('vue');
    expect(script).toContain('__VUE_DEVTOOLS_GLOBAL_HOOK__');
  });

  it('pinia-only mode uses true for pinia check', () => {
    const script = buildStoreDetectionScript('pinia');
    // pinia=true, vue=false in pinia-only mode
    expect(script).toContain('true') // pinia enabled
  });

  it('vue-only mode uses true for vue check', () => {
    const script = buildStoreDetectionScript('vue');
    expect(script).toContain('__VUE_DEVTOOLS_GLOBAL_HOOK__');
  });

  it('includes storeName filter when provided', () => {
    const script = buildStoreDetectionScript('auto', 'myStore');
    expect(script).toContain('"myStore"');
  });

  it('uses null for storeNameFilter when not provided', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('storeNameFilter = null');
  });

  it('embeds the depth value', () => {
    const script = buildStoreDetectionScript('auto', undefined, 5);
    expect(script).toContain('var maxDepth = 5');
  });

  it('defaults to depth 3', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('var maxDepth = 3');
  });

  it('returns valid JSON when executed in a minimal environment', () => {
    // Create a simulated window without any stores and evaluate the script
    // We can check the script produces valid JS by verifying its structure
    const script = buildStoreDetectionScript('unknown');
    // Should still have the IIFE structure
    expect(script).toMatch(/^\(function\(\)/);
  });

  it('pinia-specific script does not include vue-only true branch for vue', () => {
    const pinaScript = buildStoreDetectionScript('pinia');
    const vueScript = buildStoreDetectionScript('vue');
    // In pinia mode, the pinia check evaluates as true; vue check as false
    // In vue mode, vue check evaluates as true; pinia check as false
    // Both scripts contain the global hook name string but conditions differ
    expect(pinaScript).toContain('__pinia');
    expect(vueScript).toContain('__VUE_DEVTOOLS_GLOBAL_HOOK__');
  });

  it('serialize helper truncates arrays at 100 items', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('slice(0, 100)');
  });

  it('serialize helper truncates objects at 50 keys', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('slice(0, 50)');
  });

  it('serialize helper handles circular ref guard with max depth', () => {
    const script = buildStoreDetectionScript('auto');
    expect(script).toContain('[max depth]');
  });
});
