import { describe, it, expect } from 'vitest';
import {
  StorageEntrySchema,
  PageStateSchema,
  ConsoleLevelSchema,
  ConsoleEntrySchema,
  MutationTypeSchema,
  MutationEntrySchema,
  IpcEntrySchema,
  SnapshotStorageResultSchema,
  ImageFormatSchema,
  StorageTypeSchema,
  DomModeSchema,
  PackageJsonSchema,
} from '../../src/schemas/commands.js';

describe('ImageFormatSchema', () => {
  it('accepts png and jpg', () => {
    expect(ImageFormatSchema.parse('png')).toBe('png');
    expect(ImageFormatSchema.parse('jpg')).toBe('jpg');
  });

  it('rejects invalid formats', () => {
    expect(() => ImageFormatSchema.parse('gif')).toThrow();
  });
});

describe('StorageTypeSchema', () => {
  it('accepts all valid types', () => {
    for (const t of ['local', 'session', 'cookies', 'all']) {
      expect(StorageTypeSchema.parse(t)).toBe(t);
    }
  });
});

describe('DomModeSchema', () => {
  it('accepts dom and accessibility', () => {
    expect(DomModeSchema.parse('dom')).toBe('dom');
    expect(DomModeSchema.parse('accessibility')).toBe('accessibility');
  });
});

describe('StorageEntrySchema', () => {
  it('accepts valid entry', () => {
    expect(StorageEntrySchema.parse({ key: 'k', value: 'v' })).toEqual({ key: 'k', value: 'v' });
  });

  it('accepts null value', () => {
    expect(StorageEntrySchema.parse({ key: 'k', value: null })).toEqual({ key: 'k', value: null });
  });
});

describe('PageStateSchema', () => {
  it('accepts valid page state', () => {
    const state = {
      url: 'http://localhost',
      title: 'Test',
      viewport: { width: 800, height: 600 },
      scroll: { x: 0, y: 100 },
      document: { width: 800, height: 2000 },
      hasTauri: true,
    };
    expect(PageStateSchema.parse(state)).toEqual(state);
  });
});

describe('ConsoleLevelSchema', () => {
  it('accepts all valid levels', () => {
    for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
      expect(ConsoleLevelSchema.parse(level)).toBe(level);
    }
  });
});

describe('ConsoleEntrySchema', () => {
  it('accepts valid entry', () => {
    const entry = { level: 'info', message: 'hello', timestamp: 1000 };
    expect(ConsoleEntrySchema.parse(entry)).toEqual(entry);
  });
});

describe('MutationTypeSchema', () => {
  it('accepts all valid types', () => {
    for (const t of ['childList', 'attributes', 'characterData']) {
      expect(MutationTypeSchema.parse(t)).toBe(t);
    }
  });
});

describe('MutationEntrySchema', () => {
  it('accepts minimal entry', () => {
    const entry = { type: 'attributes', target: 'div#main', timestamp: 1000 };
    expect(MutationEntrySchema.parse(entry)).toEqual(entry);
  });

  it('accepts entry with added/removed nodes', () => {
    const entry = {
      type: 'childList',
      target: 'ul',
      timestamp: 1000,
      added: [{ tag: 'li', id: 'new', class: 'item' }],
      removed: [{ tag: 'li' }],
    };
    expect(MutationEntrySchema.parse(entry)).toEqual(entry);
  });

  it('accepts attribute mutation with values', () => {
    const entry = {
      type: 'attributes',
      target: 'div',
      timestamp: 1000,
      attribute: 'class',
      oldValue: 'old',
      newValue: 'new',
    };
    expect(MutationEntrySchema.parse(entry)).toEqual(entry);
  });
});

describe('IpcEntrySchema', () => {
  it('accepts valid entry', () => {
    const entry = { command: 'greet', args: { name: 'world' }, timestamp: 1000 };
    expect(IpcEntrySchema.parse(entry)).toEqual(entry);
  });

  it('accepts entry with optional fields', () => {
    const entry = {
      command: 'fetch',
      args: {},
      timestamp: 1000,
      duration: 150,
      result: { data: 'ok' },
      error: undefined,
    };
    const parsed = IpcEntrySchema.parse(entry);
    expect(parsed.command).toBe('fetch');
    expect(parsed.duration).toBe(150);
  });
});

describe('SnapshotStorageResultSchema', () => {
  it('accepts valid result', () => {
    const result = {
      localStorage: [{ key: 'a', value: '1' }],
      sessionStorage: [{ key: 'b', value: null }],
    };
    expect(SnapshotStorageResultSchema.parse(result)).toEqual(result);
  });
});

describe('PackageJsonSchema', () => {
  it('accepts valid package.json with extra fields', () => {
    const pkg = { version: '1.0.0', name: 'test', description: 'desc' };
    const parsed = PackageJsonSchema.parse(pkg);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.name).toBe('test');
  });
});
