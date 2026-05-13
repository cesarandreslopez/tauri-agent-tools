import { describe, it, expect } from 'vitest';
import { buildArgs, parseLine } from '../../../src/platform/oslog/windows.js';

describe('platform/oslog/windows', () => {
  it('buildArgs throws because Windows support is not yet implemented', () => {
    expect(() => buildArgs({ identifier: 'a', productName: 'A' })).toThrow(
      /not yet implemented on Windows/,
    );
  });

  it('parseLine returns null (stub)', () => {
    expect(parseLine('{}')).toBeNull();
  });
});
