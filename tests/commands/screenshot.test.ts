import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCropRect } from '../../src/util/image.js';

// Test the crop coordinate calculation — the core algorithm
describe('Screenshot crop calculation', () => {
  describe('computeCropRect', () => {
    it('computes correct crop with no decoration offset', () => {
      const result = computeCropRect(
        { x: 100, y: 50, width: 300, height: 200 },
        { width: 1920, height: 1080 },  // viewport matches window
        { width: 1920, height: 1080 },   // window geometry
      );

      expect(result).toEqual({
        x: 100,
        y: 50,
        width: 300,
        height: 200,
      });
    });

    it('accounts for title bar decoration', () => {
      // Window is 1920x1110 but viewport is 1920x1080 → 30px title bar
      const result = computeCropRect(
        { x: 100, y: 50, width: 300, height: 200 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1110 },
      );

      expect(result).toEqual({
        x: 100,          // decorX = 0 (no horizontal decoration)
        y: 80,           // decorY = 30 (title bar) + elemY = 50
        width: 300,
        height: 200,
      });
    });

    it('accounts for both horizontal and vertical decoration', () => {
      // Window is 1930x1110, viewport is 1920x1080
      const result = computeCropRect(
        { x: 0, y: 0, width: 500, height: 400 },
        { width: 1920, height: 1080 },
        { width: 1930, height: 1110 },
      );

      expect(result).toEqual({
        x: 10,           // decorX = 10
        y: 30,           // decorY = 30
        width: 500,
        height: 400,
      });
    });

    it('handles fractional element coordinates', () => {
      const result = computeCropRect(
        { x: 10.5, y: 20.7, width: 100.3, height: 50.9 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      );

      expect(result).toEqual({
        x: 10.5,
        y: 20.7,
        width: 100.3,
        height: 50.9,
      });
    });

    it('handles zero-offset element at origin', () => {
      const result = computeCropRect(
        { x: 0, y: 0, width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1110 },
      );

      expect(result).toEqual({
        x: 0,
        y: 30,
        width: 1920,
        height: 1080,
      });
    });
  });
});

// Test the screenshot command flow with mocked dependencies
vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/util/magick.js', () => ({
  magickCommand: vi.fn((sub: string) => Promise.resolve({ bin: sub, args: [] })),
}));

import { exec } from '../../src/util/exec.js';
import { writeFile } from 'node:fs/promises';

const mockExec = vi.mocked(exec);
const mockWriteFile = vi.mocked(writeFile);

describe('Screenshot command integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crop + resize pipeline works with mock exec', async () => {
    const fakePng = Buffer.from('fake-png');
    const croppedPng = Buffer.from('cropped-png');
    const resizedPng = Buffer.from('resized-png');

    // Mock convert for crop
    mockExec.mockResolvedValueOnce({ stdout: croppedPng, stderr: '' });
    // Mock convert for resize
    mockExec.mockResolvedValueOnce({ stdout: resizedPng, stderr: '' });

    const { cropImage, resizeImage } = await import('../../src/util/image.js');

    const cropped = await cropImage(fakePng, { x: 10, y: 20, width: 300, height: 200 }, 'png');
    expect(cropped).toBe(croppedPng);
    expect(mockExec).toHaveBeenCalledWith(
      'convert',
      ['png:-', '-crop', '300x200+10+20', '+repage', 'png:-'],
      { stdin: fakePng },
    );

    const resized = await resizeImage(cropped, 800, 'png');
    expect(resized).toBe(resizedPng);
  });
});
