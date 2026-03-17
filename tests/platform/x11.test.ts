import { describe, it, expect, vi, beforeEach } from 'vitest';
import { X11Adapter } from '../../src/platform/x11.js';

// Mock the exec utility
vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn((id: string) => {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid window ID: ${id}`);
  }),
}));

import { exec } from '../../src/util/exec.js';
const mockExec = vi.mocked(exec);

describe('X11Adapter', () => {
  let adapter: X11Adapter;

  beforeEach(() => {
    adapter = new X11Adapter();
    vi.clearAllMocks();
  });

  describe('findWindow', () => {
    it('returns the first matching window ID', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from('12345678\n87654321\n'),
        stderr: '',
      });

      const id = await adapter.findWindow('My App');
      expect(id).toBe('12345678');
      expect(mockExec).toHaveBeenCalledWith('xdotool', ['search', '--name', 'My App']);
    });

    it('throws when no windows found', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(''),
        stderr: '',
      });

      await expect(adapter.findWindow('Nonexistent')).rejects.toThrow(
        'No window found matching: Nonexistent',
      );
    });
  });

  describe('captureWindow', () => {
    it('calls import with correct arguments', async () => {
      const fakePng = Buffer.from('fake-png-data');
      mockExec.mockResolvedValue({ stdout: fakePng, stderr: '' });

      const result = await adapter.captureWindow('12345678', 'png');
      expect(result).toBe(fakePng);
      expect(mockExec).toHaveBeenCalledWith('import', ['-window', '12345678', 'png:-']);
    });

    it('uses jpg format when specified', async () => {
      mockExec.mockResolvedValue({ stdout: Buffer.from(''), stderr: '' });

      await adapter.captureWindow('12345678', 'jpg');
      expect(mockExec).toHaveBeenCalledWith('import', ['-window', '12345678', 'jpg:-']);
    });
  });

  describe('getWindowGeometry', () => {
    it('parses xdotool --shell output', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(
          'WINDOW=12345678\nX=100\nY=200\nWIDTH=1920\nHEIGHT=1080\nSCREEN=0\n',
        ),
        stderr: '',
      });

      const geom = await adapter.getWindowGeometry('12345678');
      expect(geom).toEqual({
        windowId: '12345678',
        x: 100,
        y: 200,
        width: 1920,
        height: 1080,
      });
    });

    it('throws on malformed output', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from('WINDOW=12345678\n'),
        stderr: '',
      });

      await expect(adapter.getWindowGeometry('12345678')).rejects.toThrow(
        'Failed to parse X from xdotool output',
      );
    });
  });

  describe('getWindowName', () => {
    it('returns trimmed window name', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from('My Application Title\n'),
        stderr: '',
      });

      const name = await adapter.getWindowName('12345678');
      expect(name).toBe('My Application Title');
    });
  });

  describe('window ID validation', () => {
    it('rejects non-numeric window IDs', async () => {
      await expect(adapter.captureWindow('abc', 'png')).rejects.toThrow(
        'Invalid window ID: abc',
      );
    });

    it('rejects command injection attempts', async () => {
      await expect(adapter.captureWindow('123; rm -rf /', 'png')).rejects.toThrow(
        'Invalid window ID',
      );
    });
  });
});
