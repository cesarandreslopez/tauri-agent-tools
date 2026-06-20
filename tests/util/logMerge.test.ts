import { describe, it, expect } from 'vitest';
import { parseLogLine, normalizeRustLog, inferCorrelation } from '../../src/util/logMerge.js';

describe('parseLogLine', () => {
  it('parses ISO timestamp + target + level', () => {
    const p = parseLogLine('[2026-06-19T18:00:01.500Z][app::db][INFO] opened connection');
    expect(p.ts).toBe('2026-06-19T18:00:01.500Z');
    expect(p.level).toBe('info');
    expect(p.subsystem).toBe('app::db');
    expect(p.message).toBe('opened connection');
  });

  it('combines split date/time brackets as UTC (host-timezone independent)', () => {
    const p = parseLogLine('[2026-06-19][18:00:02][sidecar][WARN] backpressure drained');
    expect(p.ts).toBe('2026-06-19T18:00:02.000Z');
    expect(p.level).toBe('warn');
    expect(p.subsystem).toBe('sidecar');
  });

  it('maps trace→debug and warning→warn', () => {
    expect(parseLogLine('[TRACE] x').level).toBe('debug');
    expect(parseLogLine('[WARNING] x').level).toBe('warn');
  });

  it('degrades a structureless line into a usable entry (inline level inference)', () => {
    const p = parseLogLine('plain line mentioning ERROR somewhere');
    expect(p.ts).toBe('');
    expect(p.level).toBe('error');
    expect(p.message).toContain('plain line');
  });
});

describe('normalizeRustLog', () => {
  it('normalizes ms timestamp → ISO, trace → debug, and preserves source', () => {
    const e = normalizeRustLog({
      timestamp: 0,
      level: 'trace',
      target: 'app::core',
      message: 'hi',
      source: 'sidecar:foo',
    });
    expect(e.ts).toBe('1970-01-01T00:00:00.000Z');
    expect(e.level).toBe('debug');
    expect(e.source).toBe('sidecar:foo');
    expect(e.subsystem).toBe('app::core');
    expect(e.origin).toBe('bridge');
  });
});

describe('inferCorrelation', () => {
  it('extracts run_id and requestId, normalizing keys', () => {
    expect(inferCorrelation('start run_id=abc requestId: req-9')).toEqual({
      runId: 'abc',
      requestId: 'req-9',
    });
  });

  it('ignores short keys like pid and returns undefined when none found', () => {
    expect(inferCorrelation('pid=3 nothing structured here')).toBeUndefined();
  });
});
