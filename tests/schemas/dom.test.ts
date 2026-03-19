import { describe, it, expect } from 'vitest';
import { DomNodeSchema, A11yNodeSchema } from '../../src/schemas/dom.js';

describe('DomNodeSchema', () => {
  it('accepts minimal node', () => {
    expect(DomNodeSchema.parse({ tag: 'div' })).toEqual({ tag: 'div' });
  });

  it('accepts node with all optional fields', () => {
    const node = {
      tag: 'div',
      id: 'main',
      classes: ['container', 'active'],
      text: 'Hello',
      rect: { width: 100, height: 50 },
      attributes: { 'data-id': '1' },
      styles: { color: 'red' },
    };
    expect(DomNodeSchema.parse(node)).toEqual(node);
  });

  it('accepts recursive children', () => {
    const tree = {
      tag: 'div',
      children: [
        { tag: 'span', text: 'child' },
        { tag: 'ul', children: [{ tag: 'li', text: 'item' }] },
      ],
    };
    expect(DomNodeSchema.parse(tree)).toEqual(tree);
  });

  it('rejects missing tag', () => {
    expect(() => DomNodeSchema.parse({ id: 'no-tag' })).toThrow();
  });
});

describe('A11yNodeSchema', () => {
  it('accepts minimal node', () => {
    expect(A11yNodeSchema.parse({ role: 'button' })).toEqual({ role: 'button' });
  });

  it('accepts node with all optional fields', () => {
    const node = {
      role: 'checkbox',
      name: 'Agree to terms',
      state: { checked: true, disabled: false },
    };
    expect(A11yNodeSchema.parse(node)).toEqual(node);
  });

  it('accepts recursive children', () => {
    const tree = {
      role: 'navigation',
      children: [
        { role: 'link', name: 'Home' },
        { role: 'list', children: [{ role: 'listitem', name: 'Item 1' }] },
      ],
    };
    expect(A11yNodeSchema.parse(tree)).toEqual(tree);
  });
});
