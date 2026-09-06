import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTools } from '../../src/platform/detect.js';
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
beforeEach(() => {
  vi.mocked(execFile).mockImplementation((_cmd, args, callback) => {
    callback(['magick', 'convert', 'grim', 'screencapture'].includes(args[0]) ? new Error('missing') : null);
    return {} as never;
  });
});
afterEach(() => vi.clearAllMocks());
describe('operation-specific dependencies', () => {
  it.each(['darwin', 'x11', 'wayland-sway', 'wayland-hyprland'])('allows window inspection on %s without screenshot tools', async platform => {
    await expect(ensureTools(platform, 'inspect')).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it('requires image tools for cropping', async () => {
    await expect(ensureTools('darwin', 'image')).rejects.toThrow('ImageMagick');
  });
  it('allows full-window PNG capture on macOS without ImageMagick', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, args, callback) => {
      callback(['magick', 'convert'].includes(args[0]) ? new Error('missing') : null);
      return {} as never;
    });
    await expect(ensureTools('darwin', 'capture')).resolves.toBeUndefined();
  });
});
