import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCropRect } from '../../src/util/image.js';

vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

import { exec } from '../../src/util/exec.js';
const mockExec = vi.mocked(exec);

describe('Image utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeCropRect', () => {
    it('basic case — no decoration offset', () => {
      const result = computeCropRect(
        { x: 50, y: 100, width: 200, height: 150 },
        { width: 800, height: 600 },
        { width: 800, height: 600 },
      );
      expect(result).toEqual({ x: 50, y: 100, width: 200, height: 150 });
    });

    it('with decoration offset', () => {
      const result = computeCropRect(
        { x: 50, y: 100, width: 200, height: 150 },
        { width: 800, height: 600 },
        { width: 800, height: 640 }, // 40px title bar
      );
      expect(result).toEqual({ x: 50, y: 140, width: 200, height: 150 });
    });

    it('element at viewport origin with decoration', () => {
      const result = computeCropRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 1280, height: 720 },
        { width: 1280, height: 750 }, // 30px decoration
      );
      expect(result).toEqual({ x: 0, y: 30, width: 100, height: 100 });
    });
  });

  describe('cropImage', () => {
    it('calls convert with correct crop geometry', async () => {
      const input = Buffer.from('input-image');
      const output = Buffer.from('cropped-image');
      mockExec.mockResolvedValue({ stdout: output, stderr: '' });

      const { cropImage } = await import('../../src/util/image.js');
      const result = await cropImage(input, { x: 10, y: 20, width: 300, height: 200 }, 'png');

      expect(result).toBe(output);
      expect(mockExec).toHaveBeenCalledWith(
        'convert',
        ['png:-', '-crop', '300x200+10+20', '+repage', 'png:-'],
        { stdin: input },
      );
    });

    it('rounds fractional coordinates', async () => {
      mockExec.mockResolvedValue({ stdout: Buffer.from(''), stderr: '' });

      const { cropImage } = await import('../../src/util/image.js');
      await cropImage(
        Buffer.from('img'),
        { x: 10.7, y: 20.3, width: 300.9, height: 200.1 },
        'png',
      );

      expect(mockExec).toHaveBeenCalledWith(
        'convert',
        ['png:-', '-crop', '301x200+11+20', '+repage', 'png:-'],
        expect.anything(),
      );
    });

    it('uses jpg format when specified', async () => {
      mockExec.mockResolvedValue({ stdout: Buffer.from(''), stderr: '' });

      const { cropImage } = await import('../../src/util/image.js');
      await cropImage(Buffer.from('img'), { x: 0, y: 0, width: 100, height: 100 }, 'jpg');

      expect(mockExec).toHaveBeenCalledWith(
        'convert',
        ['jpg:-', '-crop', '100x100+0+0', '+repage', 'jpg:-'],
        expect.anything(),
      );
    });
  });

  describe('resizeImage', () => {
    it('calls convert with correct resize geometry', async () => {
      const input = Buffer.from('large-image');
      const output = Buffer.from('resized-image');
      mockExec.mockResolvedValue({ stdout: output, stderr: '' });

      const { resizeImage } = await import('../../src/util/image.js');
      const result = await resizeImage(input, 800, 'png');

      expect(result).toBe(output);
      expect(mockExec).toHaveBeenCalledWith(
        'convert',
        ['png:-', '-resize', '800x\\>', 'png:-'],
        { stdin: input },
      );
    });
  });
});
