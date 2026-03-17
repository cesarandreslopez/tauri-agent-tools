import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacOSAdapter } from '../../src/platform/macos.js';

// Mock the exec utility
vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn((id: string) => {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid window ID: ${id}`);
  }),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));

import { exec } from '../../src/util/exec.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

const mockExec = vi.mocked(exec);
const mockMkdtemp = vi.mocked(mkdtemp);
const mockReadFile = vi.mocked(readFile);
const mockRm = vi.mocked(rm);

const windowList = [
  {
    kCGWindowNumber: 1234,
    kCGWindowName: 'My Tauri App',
    kCGWindowOwnerName: 'MyApp',
    kCGWindowBounds: { X: 100, Y: 200, Width: 800, Height: 600 },
  },
  {
    kCGWindowNumber: 5678,
    kCGWindowName: 'Safari',
    kCGWindowOwnerName: 'Safari',
    kCGWindowBounds: { X: 50, Y: 50, Width: 1200, Height: 900 },
  },
];

function mockJxaWindowList() {
  mockExec.mockResolvedValueOnce({
    stdout: Buffer.from(JSON.stringify(windowList)),
    stderr: '',
  });
}

describe('MacOSAdapter', () => {
  let adapter: MacOSAdapter;

  beforeEach(() => {
    adapter = new MacOSAdapter();
    vi.clearAllMocks();
  });

  describe('findWindow', () => {
    it('finds window by title', async () => {
      mockJxaWindowList();

      const id = await adapter.findWindow('Tauri');
      expect(id).toBe('1234');
      expect(mockExec).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript', '-e', expect.any(String)]);
    });

    it('finds window by owner name', async () => {
      mockJxaWindowList();

      const id = await adapter.findWindow('Safari');
      expect(id).toBe('5678');
    });

    it('throws when no windows found', async () => {
      mockJxaWindowList();

      await expect(adapter.findWindow('Nonexistent')).rejects.toThrow(
        'No window found matching: Nonexistent',
      );
    });
  });

  describe('captureWindow', () => {
    it('captures window via screencapture with temp file and cleanup', async () => {
      const fakePng = Buffer.from('fake-png-data');
      mockMkdtemp.mockResolvedValue('/tmp/tauri-cap-abc');
      // screencapture
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from(''), stderr: '' });
      // getWindowGeometry (JXA call)
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(windowList)),
        stderr: '',
      });
      // sips -g pixelWidth (normalizeRetina)
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('  pixelWidth: 800\n'),
        stderr: '',
      });
      mockReadFile.mockResolvedValue(fakePng);
      mockRm.mockResolvedValue(undefined);

      const result = await adapter.captureWindow('1234', 'png');
      expect(result).toEqual(fakePng);
      expect(mockExec).toHaveBeenCalledWith('screencapture', [
        '-l', '1234', '-o', '-x', '/tmp/tauri-cap-abc/capture.png',
      ]);
      // Verify cleanup
      expect(mockRm).toHaveBeenCalledWith('/tmp/tauri-cap-abc', { recursive: true, force: true });
    });

    it('converts to jpg when format is jpg', async () => {
      const fakeJpg = Buffer.from('fake-jpg-data');
      mockMkdtemp.mockResolvedValue('/tmp/tauri-cap-abc');
      // screencapture
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from(''), stderr: '' });
      // getWindowGeometry
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(windowList)),
        stderr: '',
      });
      // sips -g pixelWidth
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('  pixelWidth: 800\n'),
        stderr: '',
      });
      // sips format conversion
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from(''), stderr: '' });
      mockReadFile.mockResolvedValue(fakeJpg);
      mockRm.mockResolvedValue(undefined);

      await adapter.captureWindow('1234', 'jpg');
      expect(mockExec).toHaveBeenCalledWith('sips', [
        '-s', 'format', 'jpeg',
        '/tmp/tauri-cap-abc/capture.jpg',
        '--out', '/tmp/tauri-cap-abc/capture.jpg',
      ]);
    });

    it('cleans up temp dir even on error', async () => {
      mockMkdtemp.mockResolvedValue('/tmp/tauri-cap-abc');
      mockExec.mockRejectedValueOnce(new Error('screencapture failed'));
      mockRm.mockResolvedValue(undefined);

      await expect(adapter.captureWindow('1234', 'png')).rejects.toThrow('screencapture failed');
      expect(mockRm).toHaveBeenCalledWith('/tmp/tauri-cap-abc', { recursive: true, force: true });
    });
  });

  describe('getWindowGeometry', () => {
    it('returns window bounds from JXA', async () => {
      mockJxaWindowList();

      const geom = await adapter.getWindowGeometry('1234');
      expect(geom).toEqual({
        windowId: '1234',
        name: 'My Tauri App',
        x: 100,
        y: 200,
        width: 800,
        height: 600,
      });
    });

    it('throws when window ID not found', async () => {
      mockJxaWindowList();

      await expect(adapter.getWindowGeometry('9999')).rejects.toThrow(
        'Window 9999 not found',
      );
    });
  });

  describe('getWindowName', () => {
    it('delegates to getWindowGeometry', async () => {
      mockJxaWindowList();

      const name = await adapter.getWindowName('1234');
      expect(name).toBe('My Tauri App');
    });
  });

  describe('window ID validation', () => {
    it('rejects non-numeric window IDs', async () => {
      await expect(adapter.captureWindow('abc', 'png')).rejects.toThrow(
        'Invalid window ID: abc',
      );
    });

    it('rejects command injection attempts', async () => {
      await expect(adapter.getWindowGeometry('123; rm -rf /')).rejects.toThrow(
        'Invalid window ID',
      );
    });
  });

  describe('Retina normalization', () => {
    it('downsamples when pixel width exceeds logical width', async () => {
      const fakePng = Buffer.from('fake-retina-png');
      mockMkdtemp.mockResolvedValue('/tmp/tauri-cap-abc');
      // screencapture
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from(''), stderr: '' });
      // getWindowGeometry
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(windowList)),
        stderr: '',
      });
      // sips -g pixelWidth returns 2x
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('  pixelWidth: 1600\n'),
        stderr: '',
      });
      // sips --resampleWidth
      mockExec.mockResolvedValueOnce({ stdout: Buffer.from(''), stderr: '' });
      mockReadFile.mockResolvedValue(fakePng);
      mockRm.mockResolvedValue(undefined);

      await adapter.captureWindow('1234', 'png');

      expect(mockExec).toHaveBeenCalledWith('sips', [
        '--resampleWidth', '800',
        '/tmp/tauri-cap-abc/capture.png',
      ]);
    });
  });

  describe('Screen Recording permission', () => {
    it('throws clear error when all window names are empty', async () => {
      const emptyWindows = [
        {
          kCGWindowNumber: 1,
          kCGWindowName: '',
          kCGWindowOwnerName: '',
          kCGWindowBounds: { X: 0, Y: 0, Width: 100, Height: 100 },
        },
        {
          kCGWindowNumber: 2,
          kCGWindowName: '',
          kCGWindowOwnerName: '',
          kCGWindowBounds: { X: 0, Y: 0, Width: 200, Height: 200 },
        },
      ];

      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(emptyWindows)),
        stderr: '',
      });

      await expect(adapter.findWindow('Safari')).rejects.toThrow(
        'Screen Recording permission required',
      );
    });
  });
});
