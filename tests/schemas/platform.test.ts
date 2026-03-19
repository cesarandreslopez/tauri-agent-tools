import { describe, it, expect } from 'vitest';
import {
  WindowIdSchema,
  CGWindowInfoSchema,
  SwayNodeSchema,
} from '../../src/schemas/platform.js';

describe('WindowIdSchema', () => {
  it('accepts numeric strings', () => {
    expect(WindowIdSchema.parse('12345')).toBe('12345');
    expect(WindowIdSchema.parse('0')).toBe('0');
  });

  it('rejects non-numeric strings', () => {
    expect(() => WindowIdSchema.parse('abc')).toThrow();
    expect(() => WindowIdSchema.parse('12a')).toThrow();
    expect(() => WindowIdSchema.parse('')).toThrow();
  });
});

describe('CGWindowInfoSchema', () => {
  it('accepts valid macOS window info', () => {
    const info = {
      kCGWindowNumber: 42,
      kCGWindowOwnerPID: 1234,
      kCGWindowName: 'My Window',
      kCGWindowOwnerName: 'MyApp',
      kCGWindowBounds: { X: 0, Y: 0, Width: 800, Height: 600 },
    };
    expect(CGWindowInfoSchema.parse(info)).toEqual(info);
  });

  it('accepts minimal info (optional fields omitted)', () => {
    const info = {
      kCGWindowNumber: 1,
      kCGWindowBounds: { X: 0, Y: 0, Width: 100, Height: 100 },
    };
    expect(CGWindowInfoSchema.parse(info)).toEqual(info);
  });
});

describe('SwayNodeSchema', () => {
  it('accepts minimal node', () => {
    const node = {
      id: 1,
      name: 'root',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    };
    expect(SwayNodeSchema.parse(node)).toEqual(node);
  });

  it('accepts null name', () => {
    const node = {
      id: 1,
      name: null,
      rect: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(SwayNodeSchema.parse(node)).toEqual(node);
  });

  it('accepts recursive nodes and floating_nodes', () => {
    const tree = {
      id: 1,
      name: 'root',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      nodes: [
        {
          id: 2,
          pid: 1234,
          name: 'workspace',
          rect: { x: 0, y: 0, width: 960, height: 1080 },
          nodes: [
            { id: 3, name: 'window', rect: { x: 0, y: 0, width: 960, height: 1080 } },
          ],
        },
      ],
      floating_nodes: [
        { id: 4, name: 'floating', rect: { x: 100, y: 100, width: 400, height: 300 } },
      ],
    };
    expect(SwayNodeSchema.parse(tree)).toEqual(tree);
  });
});
