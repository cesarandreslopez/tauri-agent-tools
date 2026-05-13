import { describe, it, expect } from 'vitest';
import { buildArgs, parseLine, COMMAND } from '../../../src/platform/oslog/linux.js';

describe('platform/oslog/linux', () => {
  it('COMMAND is "journalctl"', () => {
    expect(COMMAND).toBe('journalctl');
  });

  it('buildArgs follows user journal with json output and SYSLOG_IDENTIFIER filters', () => {
    const args = buildArgs({ identifier: 'com.test.app', productName: 'TestApp' });
    expect(args).toContain('--user');
    expect(args).toContain('-f');
    expect(args).toContain('-o');
    expect(args).toContain('json');
    expect(args).toContain('-t');
    expect(args).toContain('TestApp');
    expect(args).toContain('com.test.app');
  });

  it('buildArgs includes --since when provided', () => {
    const args = buildArgs({ identifier: 'a', productName: 'A', since: '5m' });
    expect(args).toContain('--since');
    expect(args).toContain('5m');
  });

  it('parseLine maps PRIORITY to our 4-level taxonomy', () => {
    const mk = (priority: string) =>
      JSON.stringify({ MESSAGE: 'm', SYSLOG_IDENTIFIER: 'A', PRIORITY: priority, __REALTIME_TIMESTAMP: '1700000000000000' });
    expect(parseLine(mk('3'))?.level).toBe('error');
    expect(parseLine(mk('4'))?.level).toBe('warn');
    expect(parseLine(mk('5'))?.level).toBe('info');
    expect(parseLine(mk('7'))?.level).toBe('debug');
  });

  it('parseLine converts __REALTIME_TIMESTAMP microseconds to ISO', () => {
    const line = JSON.stringify({
      MESSAGE: 'hi',
      SYSLOG_IDENTIFIER: 'TestApp',
      PRIORITY: '6',
      __REALTIME_TIMESTAMP: '1700000000000000',
    });
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry?.ts).toMatch(/^2023-/);
    expect(entry?.message).toBe('hi');
    expect(entry?.subsystem).toBe('TestApp');
  });

  it('parseLine returns null on non-JSON lines', () => {
    expect(parseLine('-- Logs begin at … --')).toBeNull();
    expect(parseLine('')).toBeNull();
  });
});
