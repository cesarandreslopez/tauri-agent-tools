import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HyprlandAdapter } from '../../src/platform/hyprland.js';

vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

import { exec } from '../../src/util/exec.js';
const mockExec = vi.mocked(exec);

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    address: '0x561db2322550',
    mapped: true,
    hidden: false,
    at: [50, 100],
    size: [800, 600],
    title: 'My Tauri App',
    pid: 5001,
    ...overrides,
  };
}

const clients = [
  makeClient(),
  makeClient({
    address: '0x561db2322660',
    title: 'Firefox',
    pid: 5002,
    at: [900, 100],
    size: [1000, 900],
  }),
];

describe('HyprlandAdapter', () => {
  let adapter: HyprlandAdapter;

  beforeEach(() => {
    adapter = new HyprlandAdapter();
    vi.clearAllMocks();
  });

  describe('findWindow', () => {
    it('finds window by title', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });

      const id = await adapter.findWindow('Tauri');
      expect(id).toBe('0x561db2322550');
    });

    it('throws when window not found', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });

      await expect(adapter.findWindow('Nonexistent')).rejects.toThrow(
        'No window found matching: Nonexistent',
      );
    });

    it('ignores unmapped windows', async () => {
      const unmapped = [makeClient({ mapped: false, title: 'Hidden App' })];
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(unmapped)),
        stderr: '',
      });

      await expect(adapter.findWindow('Hidden')).rejects.toThrow(
        'No window found matching: Hidden',
      );
    });

    it('ignores hidden windows', async () => {
      const hidden = [makeClient({ hidden: true, title: 'Hidden App' })];
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(hidden)),
        stderr: '',
      });

      await expect(adapter.findWindow('Hidden')).rejects.toThrow(
        'No window found matching: Hidden',
      );
    });
  });

  describe('getWindowGeometry', () => {
    it('returns window geometry', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });

      const geom = await adapter.getWindowGeometry('0x561db2322550');
      expect(geom).toEqual({
        windowId: '0x561db2322550',
        pid: 5001,
        name: 'My Tauri App',
        x: 50,
        y: 100,
        width: 800,
        height: 600,
      });
    });

    it('throws when window not found', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });

      await expect(adapter.getWindowGeometry('0xdead')).rejects.toThrow(
        'Window 0xdead not found',
      );
    });
  });

  describe('listWindows', () => {
    it('returns all mapped visible windows', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });

      const windows = await adapter.listWindows();
      expect(windows).toHaveLength(2);
      expect(windows[0]).toEqual({
        windowId: '0x561db2322550',
        pid: 5001,
        name: 'My Tauri App',
        x: 50,
        y: 100,
        width: 800,
        height: 600,
      });
      expect(windows[1]).toEqual({
        windowId: '0x561db2322660',
        pid: 5002,
        name: 'Firefox',
        x: 900,
        y: 100,
        width: 1000,
        height: 900,
      });
    });

    it('filters out unmapped and hidden windows', async () => {
      const mixed = [
        makeClient(),
        makeClient({ address: '0x2', mapped: false, title: 'Unmapped' }),
        makeClient({ address: '0x3', hidden: true, title: 'Hidden' }),
      ];
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(mixed)),
        stderr: '',
      });

      const windows = await adapter.listWindows();
      expect(windows).toHaveLength(1);
      expect(windows[0].name).toBe('My Tauri App');
    });
  });

  describe('captureWindow', () => {
    it('captures region using grim', async () => {
      const fakeImage = Buffer.from('fake-image');
      // First call: hyprctl clients
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });
      // Second call: grim capture
      mockExec.mockResolvedValueOnce({
        stdout: fakeImage,
        stderr: '',
      });

      const result = await adapter.captureWindow('0x561db2322550', 'png');
      expect(result).toBe(fakeImage);

      expect(mockExec).toHaveBeenCalledWith('grim', [
        '-g', '50,100 800x600',
        '-t', 'png',
        '-',
      ]);
    });

    it('maps jpg format to jpeg for grim', async () => {
      const fakeImage = Buffer.from('fake-jpg-image');
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({
        stdout: fakeImage,
        stderr: '',
      });

      const result = await adapter.captureWindow('0x561db2322550', 'jpg');
      expect(result).toBe(fakeImage);

      expect(mockExec).toHaveBeenCalledWith('grim', [
        '-g', '50,100 800x600',
        '-t', 'jpeg',
        '-',
      ]);
    });
  });

  describe('getWindowName', () => {
    it('returns window title', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(clients)),
        stderr: '',
      });

      const name = await adapter.getWindowName('0x561db2322550');
      expect(name).toBe('My Tauri App');
    });
  });
});
