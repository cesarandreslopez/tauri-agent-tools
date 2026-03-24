import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

import { detectMagickVersion, magickCommand, _resetMagickCache } from '../../src/util/magick.js';

function mockWhich(available: string[]) {
  mockExecFile.mockImplementation((_cmd: string, args: unknown, cb: unknown) => {
    const name = (args as string[])[0];
    const callback = cb as (error: Error | null) => void;
    if (available.includes(name!)) {
      callback(null);
    } else {
      callback(new Error(`not found: ${name}`));
    }
    return undefined as never;
  });
}

describe('ImageMagick version detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMagickCache();
  });

  describe('detectMagickVersion', () => {
    it('returns 7 when magick command exists', async () => {
      mockWhich(['magick']);
      expect(await detectMagickVersion()).toBe(7);
    });

    it('returns 6 when only convert exists (no magick)', async () => {
      mockWhich(['convert', 'import', 'identify', 'compare']);
      expect(await detectMagickVersion()).toBe(6);
    });

    it('throws when neither magick nor convert exists', async () => {
      mockWhich([]);
      await expect(detectMagickVersion()).rejects.toThrow('ImageMagick not found');
    });

    it('caches the result after first detection', async () => {
      mockWhich(['magick']);
      await detectMagickVersion();
      await detectMagickVersion();
      // `which` should only be called once for 'magick' (cached after first call)
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('magickCommand', () => {
    it('returns magick with no subcommand for convert in v7', async () => {
      mockWhich(['magick']);
      expect(await magickCommand('convert')).toEqual({ bin: 'magick', args: [] });
    });

    it('returns magick + subcommand for non-convert tools in v7', async () => {
      mockWhich(['magick']);
      expect(await magickCommand('import')).toEqual({ bin: 'magick', args: ['import'] });
      expect(await magickCommand('identify')).toEqual({ bin: 'magick', args: ['identify'] });
      expect(await magickCommand('compare')).toEqual({ bin: 'magick', args: ['compare'] });
    });

    it('returns standalone command for v6', async () => {
      mockWhich(['convert', 'import', 'identify', 'compare']);
      expect(await magickCommand('convert')).toEqual({ bin: 'convert', args: [] });
      expect(await magickCommand('import')).toEqual({ bin: 'import', args: [] });
      expect(await magickCommand('identify')).toEqual({ bin: 'identify', args: [] });
      expect(await magickCommand('compare')).toEqual({ bin: 'compare', args: [] });
    });
  });
});
