import { describe, it, expect } from 'vitest';
import { LineFramer, NdjsonValidator } from '../../src/util/ndjson.js';

describe('LineFramer', () => {
  it('emits complete lines, holds back partial trailing data', () => {
    const lf = new LineFramer();
    expect(lf.push('hello')).toEqual([]);
    expect(lf.push('\nworld')).toEqual(['hello']);
    expect(lf.push('\n')).toEqual(['world']);
  });

  it('strips trailing \\r so CRLF and LF behave identically', () => {
    const lf = new LineFramer();
    expect(lf.push('a\r\nb\nc\r\n')).toEqual(['a', 'b', 'c']);
  });

  it('handles split chunks across the newline boundary', () => {
    const lf = new LineFramer();
    expect(lf.push('foo\r')).toEqual([]);
    expect(lf.push('\nbar')).toEqual(['foo']);
    expect(lf.flush()).toBe('bar');
  });

  it('emits blank lines (caller decides to skip)', () => {
    const lf = new LineFramer();
    expect(lf.push('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  it('flush returns null when buffer is empty', () => {
    const lf = new LineFramer();
    lf.push('a\n');
    expect(lf.flush()).toBeNull();
  });

  it('accepts Buffer inputs as well as strings', () => {
    const lf = new LineFramer();
    expect(lf.push(Buffer.from('one\ntwo\n'))).toEqual(['one', 'two']);
  });
});

describe('NdjsonValidator', () => {
  it('reports JSON parse errors with ok: false', () => {
    const v = new NdjsonValidator();
    const result = v.parse('not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('JSON');
  });

  it('returns valid: true when no schema is supplied', () => {
    const v = new NdjsonValidator();
    expect(v.hasSchema()).toBe(false);
    const result = v.parse('{"foo":1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toBe(true);
      expect(result.value).toEqual({ foo: 1 });
      expect(result.errors).toEqual([]);
    }
  });

  it('validates against a compiled JSON Schema', () => {
    const v = new NdjsonValidator({
      type: 'object',
      required: ['ts', 'level'],
      properties: { ts: { type: 'number' }, level: { type: 'string' } },
    });
    expect(v.hasSchema()).toBe(true);

    const good = v.parse('{"ts":1700000000,"level":"info"}');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.valid).toBe(true);

    const bad = v.parse('{"ts":"not a number"}');
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      expect(bad.valid).toBe(false);
      expect(bad.errors.length).toBeGreaterThan(0);
    }
  });

  it('supports ajv-formats (e.g., date-time)', () => {
    const v = new NdjsonValidator({
      type: 'object',
      properties: { ts: { type: 'string', format: 'date-time' } },
      required: ['ts'],
    });
    const good = v.parse('{"ts":"2026-01-01T00:00:00Z"}');
    if (good.ok) expect(good.valid).toBe(true);

    const bad = v.parse('{"ts":"not a date"}');
    if (bad.ok) expect(bad.valid).toBe(false);
  });
});
