import { describe, it, expect } from 'vitest';
import { mergeByTimestamp } from '../../src/util/mergeByTimestamp.js';

describe('mergeByTimestamp', () => {
  it('interleaves multiple sources in ascending timestamp order', () => {
    const a = [
      { ts: '2026-01-01T00:00:01Z', tag: 'a1' },
      { ts: '2026-01-01T00:00:03Z', tag: 'a2' },
    ];
    const b = [
      { ts: '2026-01-01T00:00:02Z', tag: 'b1' },
      { ts: '2026-01-01T00:00:04Z', tag: 'b2' },
    ];
    expect(mergeByTimestamp([a, b]).map((e) => e.tag)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('is stable for equal timestamps (preserves source/insertion order)', () => {
    const a = [{ ts: '2026-01-01T00:00:00Z', tag: 'a' }];
    const b = [{ ts: '2026-01-01T00:00:00Z', tag: 'b' }];
    expect(mergeByTimestamp([a, b]).map((e) => e.tag)).toEqual(['a', 'b']);
    expect(mergeByTimestamp([b, a]).map((e) => e.tag)).toEqual(['b', 'a']);
  });

  it('sorts unparseable timestamps last, preserving their relative order', () => {
    const a = [
      { ts: '', tag: 'x' },
      { ts: '2026-01-01T00:00:00Z', tag: 'y' },
      { ts: 'not-a-date', tag: 'z' },
    ];
    expect(mergeByTimestamp([a]).map((e) => e.tag)).toEqual(['y', 'x', 'z']);
  });

  it('handles empty sources', () => {
    expect(mergeByTimestamp<{ ts: string }>([[], []])).toEqual([]);
  });
});
