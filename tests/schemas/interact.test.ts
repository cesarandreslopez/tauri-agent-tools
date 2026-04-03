import { describe, it, expect } from 'vitest';
import {
  InteractionResultSchema,
  ClickResultSchema,
  TypeResultSchema,
  ScrollResultSchema,
  SelectResultSchema,
  InvokeResultSchema,
} from '../../src/schemas/interact.js';

describe('InteractionResultSchema', () => {
  it('accepts minimal valid data', () => {
    const data = { success: true };
    expect(InteractionResultSchema.parse(data)).toEqual(data);
  });

  it('accepts all optional fields', () => {
    const data = { success: false, selector: '#btn', tagName: 'BUTTON', error: 'not found' };
    expect(InteractionResultSchema.parse(data)).toEqual(data);
  });

  it('rejects missing success', () => {
    expect(() => InteractionResultSchema.parse({})).toThrow();
  });

  it('rejects non-boolean success', () => {
    expect(() => InteractionResultSchema.parse({ success: 'yes' })).toThrow();
  });
});

describe('ClickResultSchema', () => {
  it('accepts minimal valid data', () => {
    const data = { success: true };
    expect(ClickResultSchema.parse(data)).toEqual(data);
  });

  it('accepts text field', () => {
    const data = { success: true, selector: '#btn', tagName: 'BUTTON', text: 'Click me' };
    expect(ClickResultSchema.parse(data)).toEqual(data);
  });

  it('inherits base fields', () => {
    const data = { success: false, selector: '.link', error: 'element not visible' };
    expect(ClickResultSchema.parse(data)).toEqual(data);
  });

  it('rejects missing success', () => {
    expect(() => ClickResultSchema.parse({ text: 'hello' })).toThrow();
  });
});

describe('TypeResultSchema', () => {
  it('accepts minimal valid data', () => {
    const data = { success: true };
    expect(TypeResultSchema.parse(data)).toEqual(data);
  });

  it('accepts value field', () => {
    const data = { success: true, selector: '#input', tagName: 'INPUT', value: 'typed text' };
    expect(TypeResultSchema.parse(data)).toEqual(data);
  });

  it('rejects missing success', () => {
    expect(() => TypeResultSchema.parse({ value: 'text' })).toThrow();
  });
});

describe('ScrollResultSchema', () => {
  it('accepts minimal valid data', () => {
    const data = { success: true };
    expect(ScrollResultSchema.parse(data)).toEqual(data);
  });

  it('accepts scroll position fields', () => {
    const data = { success: true, scrollX: 0, scrollY: 500 };
    expect(ScrollResultSchema.parse(data)).toEqual(data);
  });

  it('accepts error field', () => {
    const data = { success: false, error: 'scroll failed' };
    expect(ScrollResultSchema.parse(data)).toEqual(data);
  });

  it('rejects missing success', () => {
    expect(() => ScrollResultSchema.parse({ scrollX: 0 })).toThrow();
  });

  it('rejects non-number scroll values', () => {
    expect(() => ScrollResultSchema.parse({ success: true, scrollX: 'zero' })).toThrow();
  });

  it('does not accept base interaction fields like selector', () => {
    const data = { success: true, scrollX: 0, scrollY: 0 };
    const result = ScrollResultSchema.parse(data);
    expect(result).toEqual(data);
  });
});

describe('SelectResultSchema', () => {
  it('accepts minimal valid data', () => {
    const data = { success: true };
    expect(SelectResultSchema.parse(data)).toEqual(data);
  });

  it('accepts value and checked fields', () => {
    const data = { success: true, selector: '#checkbox', tagName: 'INPUT', value: 'on', checked: true };
    expect(SelectResultSchema.parse(data)).toEqual(data);
  });

  it('inherits base fields', () => {
    const data = { success: false, selector: 'select#opts', error: 'option not found' };
    expect(SelectResultSchema.parse(data)).toEqual(data);
  });

  it('rejects missing success', () => {
    expect(() => SelectResultSchema.parse({ value: 'opt1' })).toThrow();
  });

  it('rejects non-boolean checked', () => {
    expect(() => SelectResultSchema.parse({ success: true, checked: 'yes' })).toThrow();
  });
});

describe('InvokeResultSchema', () => {
  it('accepts minimal valid data', () => {
    const data = { success: true, command: 'greet' };
    expect(InvokeResultSchema.parse(data)).toEqual(data);
  });

  it('accepts result of any type', () => {
    expect(InvokeResultSchema.parse({ success: true, command: 'get_data', result: { key: 'value' } }))
      .toEqual({ success: true, command: 'get_data', result: { key: 'value' } });
    expect(InvokeResultSchema.parse({ success: true, command: 'count', result: 42 }))
      .toEqual({ success: true, command: 'count', result: 42 });
    expect(InvokeResultSchema.parse({ success: true, command: 'check', result: null }))
      .toEqual({ success: true, command: 'check', result: null });
  });

  it('accepts error field', () => {
    const data = { success: false, command: 'fail_cmd', error: 'command not found' };
    expect(InvokeResultSchema.parse(data)).toEqual(data);
  });

  it('rejects missing success', () => {
    expect(() => InvokeResultSchema.parse({ command: 'test' })).toThrow();
  });

  it('rejects missing command', () => {
    expect(() => InvokeResultSchema.parse({ success: true })).toThrow();
  });
});
