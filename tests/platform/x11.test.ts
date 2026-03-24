import { describe, it, expect, vi, beforeEach } from 'vitest';
import { X11Adapter } from '../../src/platform/x11.js';

// Mock the exec utility
vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn((id: string) => {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid window ID: ${id}`);
  }),
}));

vi.mock('../../src/util/magick.js', () => ({
  magickCommand: vi.fn((sub: string) => Promise.resolve({ bin: sub, args: [] })),
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

  describe('listWindows', () => {
    it('returns all windows with names and PIDs', async () => {
      // xdotool search --name ''
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('111\n222\n333\n'),
        stderr: '',
      });

      // Window 111: name + geom + pid
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('My App\n'), stderr: '' });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('WINDOW=111\nX=0\nY=0\nWIDTH=800\nHEIGHT=600\n'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('1001\n'), stderr: '' });

      // Window 222: empty name (should be filtered out)
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('\n'), stderr: '' });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('WINDOW=222\nX=0\nY=0\nWIDTH=100\nHEIGHT=100\n'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('1002\n'), stderr: '' });

      // Window 333: name + geom + pid
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('Firefox\n'), stderr: '' });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('WINDOW=333\nX=100\nY=100\nWIDTH=1200\nHEIGHT=900\n'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('1003\n'), stderr: '' });

      const windows = await adapter.listWindows();
      expect(windows).toHaveLength(2);
      expect(windows[0]).toEqual({
        windowId: '111',
        pid: 1001,
        name: 'My App',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
      expect(windows[1]).toEqual({
        windowId: '333',
        pid: 1003,
        name: 'Firefox',
        x: 100,
        y: 100,
        width: 1200,
        height: 900,
      });
    });

    it('skips windows that throw errors', async () => {
      // xdotool search --name ''
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('111\n222\n'),
        stderr: '',
      });

      // Window 111: all three calls fail (Promise.all rejects)
      mockExec.mockRejectedValueOnce(new Error('window gone'));
      mockExec.mockRejectedValueOnce(new Error('window gone'));
      mockExec.mockRejectedValueOnce(new Error('window gone'));

      // Window 222: succeeds
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('App\n'), stderr: '' });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('WINDOW=222\nX=0\nY=0\nWIDTH=640\nHEIGHT=480\n'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from('2002\n'), stderr: '' });

      const windows = await adapter.listWindows();
      expect(windows).toHaveLength(1);
      expect(windows[0].name).toBe('App');
    });

    it('returns empty array when no windows exist', async () => {
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from(''), stderr: '' });

      const windows = await adapter.listWindows();
      expect(windows).toHaveLength(0);
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
