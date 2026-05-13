import { describe, it, expect } from 'vitest';
import { buildArgs, parseLine, COMMAND } from '../../../src/platform/oslog/darwin.js';

describe('platform/oslog/darwin', () => {
  it('COMMAND is "log"', () => {
    expect(COMMAND).toBe('log');
  });

  it('buildArgs produces a stream predicate with subsystem + sender path', () => {
    const args = buildArgs({ identifier: 'com.test.app', productName: 'TestApp' });
    expect(args[0]).toBe('stream');
    expect(args).toContain('--predicate');
    expect(args).toContain('--style');
    expect(args).toContain('ndjson');
    const predicate = args[args.indexOf('--predicate') + 1] as string;
    expect(predicate).toContain('subsystem == "com.test.app"');
    expect(predicate).toContain('senderImagePath');
    expect(predicate).toContain('TestApp');
  });

  it('parseLine skips non-JSON metadata lines', () => {
    expect(parseLine('Filtering the log data using "subsystem == \\"x\\""')).toBeNull();
    expect(parseLine('')).toBeNull();
  });

  it('parseLine normalizes a real-shape macOS log entry', () => {
    const raw = JSON.stringify({
      timestamp: '2026-05-13 08:11:43.771694-0500',
      messageType: 'Default',
      eventMessage: 'hello world',
      subsystem: 'com.test.app',
      senderImagePath: '/Applications/TestApp.app/Contents/MacOS/TestApp',
    });
    const entry = parseLine(raw);
    expect(entry).not.toBeNull();
    expect(entry?.message).toBe('hello world');
    expect(entry?.subsystem).toBe('com.test.app');
    expect(entry?.source).toBe('main');
    expect(entry?.ts).toBe('2026-05-13 08:11:43.771694-0500');
    expect(entry?.level).toBe('info');
  });

  it('parseLine identifies webview sources by WebKit sender path', () => {
    const raw = JSON.stringify({
      timestamp: 't',
      messageType: 'Default',
      eventMessage: 'a',
      subsystem: '',
      senderImagePath: '/System/Library/Frameworks/WebKit.framework/WebKit',
    });
    expect(parseLine(raw)?.source).toBe('webview');
  });

  it('parseLine maps error/fault to error level', () => {
    const raw = JSON.stringify({
      timestamp: 't',
      messageType: 'Error',
      eventMessage: 'fail',
      subsystem: '',
      senderImagePath: '/bin/foo',
    });
    expect(parseLine(raw)?.level).toBe('error');
  });

  it('parseLine returns null on malformed JSON', () => {
    expect(parseLine('{ not json')).toBeNull();
  });
});
