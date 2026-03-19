import { describe, it, expect } from 'vitest';
import {
  TokenFileSchema,
  ElementRectSchema,
  BridgeConfigSchema,
  ViewportSizeSchema,
  RustLogLevelSchema,
  RustLogEntrySchema,
  BridgeEvalResponseSchema,
  BridgeLogsResponseSchema,
} from '../../src/schemas/bridge.js';

describe('TokenFileSchema', () => {
  it('accepts valid token file data', () => {
    const data = { port: 9876, token: 'abc123', pid: 42 };
    expect(TokenFileSchema.parse(data)).toEqual(data);
  });

  it('rejects port out of range', () => {
    expect(() => TokenFileSchema.parse({ port: 0, token: 'x', pid: 1 })).toThrow();
    expect(() => TokenFileSchema.parse({ port: 70000, token: 'x', pid: 1 })).toThrow();
  });

  it('rejects empty token', () => {
    expect(() => TokenFileSchema.parse({ port: 8080, token: '', pid: 1 })).toThrow();
  });

  it('rejects non-positive pid', () => {
    expect(() => TokenFileSchema.parse({ port: 8080, token: 'x', pid: 0 })).toThrow();
  });
});

describe('ElementRectSchema', () => {
  it('accepts valid rect', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(ElementRectSchema.parse(rect)).toEqual(rect);
  });

  it('rejects missing fields', () => {
    expect(() => ElementRectSchema.parse({ x: 0, y: 0 })).toThrow();
  });
});

describe('BridgeConfigSchema', () => {
  it('accepts valid config', () => {
    const config = { port: 9999, token: 'test-token' };
    expect(BridgeConfigSchema.parse(config)).toEqual(config);
  });

  it('rejects port out of range', () => {
    expect(() => BridgeConfigSchema.parse({ port: 0, token: 'x' })).toThrow();
    expect(() => BridgeConfigSchema.parse({ port: 70000, token: 'x' })).toThrow();
  });

  it('rejects non-integer port', () => {
    expect(() => BridgeConfigSchema.parse({ port: 80.5, token: 'x' })).toThrow();
  });

  it('rejects empty token', () => {
    expect(() => BridgeConfigSchema.parse({ port: 8080, token: '' })).toThrow();
  });
});

describe('ViewportSizeSchema', () => {
  it('accepts valid viewport', () => {
    expect(ViewportSizeSchema.parse({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
  });
});

describe('RustLogLevelSchema', () => {
  it('accepts all valid levels', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
      expect(RustLogLevelSchema.parse(level)).toBe(level);
    }
  });

  it('rejects invalid levels', () => {
    expect(() => RustLogLevelSchema.parse('verbose')).toThrow();
  });
});

describe('RustLogEntrySchema', () => {
  it('accepts valid log entry', () => {
    const entry = {
      timestamp: Date.now(),
      level: 'info',
      target: 'app',
      message: 'hello',
      source: 'rust',
    };
    expect(RustLogEntrySchema.parse(entry)).toEqual(entry);
  });
});

describe('BridgeEvalResponseSchema', () => {
  it('accepts any result value', () => {
    expect(BridgeEvalResponseSchema.parse({ result: 42 })).toEqual({ result: 42 });
    expect(BridgeEvalResponseSchema.parse({ result: null })).toEqual({ result: null });
    expect(BridgeEvalResponseSchema.parse({ result: 'text' })).toEqual({ result: 'text' });
  });
});

describe('BridgeLogsResponseSchema', () => {
  it('accepts valid logs response', () => {
    const data = {
      entries: [{
        timestamp: 1000, level: 'info', target: 'app', message: 'ok', source: 'rust',
      }],
    };
    expect(BridgeLogsResponseSchema.parse(data)).toEqual(data);
  });

  it('accepts empty entries', () => {
    expect(BridgeLogsResponseSchema.parse({ entries: [] })).toEqual({ entries: [] });
  });
});
