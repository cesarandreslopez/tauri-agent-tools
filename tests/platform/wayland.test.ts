import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaylandAdapter } from '../../src/platform/wayland.js';

vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

import { exec } from '../../src/util/exec.js';
const mockExec = vi.mocked(exec);

const swayTree = {
  id: 1,
  name: 'root',
  rect: { x: 0, y: 0, width: 3840, height: 2160 },
  nodes: [
    {
      id: 2,
      name: 'output',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      nodes: [
        {
          id: 100,
          name: 'My Tauri App',
          rect: { x: 50, y: 100, width: 800, height: 600 },
          nodes: [],
          floating_nodes: [],
        },
        {
          id: 101,
          name: 'Firefox',
          rect: { x: 900, y: 100, width: 1000, height: 900 },
          nodes: [],
          floating_nodes: [],
        },
      ],
      floating_nodes: [],
    },
  ],
  floating_nodes: [],
};

describe('WaylandAdapter', () => {
  let adapter: WaylandAdapter;

  beforeEach(() => {
    adapter = new WaylandAdapter();
    vi.clearAllMocks();
  });

  describe('findWindow', () => {
    it('finds window by title in sway tree', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(swayTree)),
        stderr: '',
      });

      const id = await adapter.findWindow('Tauri');
      expect(id).toBe('100');
    });

    it('throws when window not found', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(swayTree)),
        stderr: '',
      });

      await expect(adapter.findWindow('Nonexistent')).rejects.toThrow(
        'No window found matching: Nonexistent',
      );
    });
  });

  describe('getWindowGeometry', () => {
    it('returns window geometry from tree', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(swayTree)),
        stderr: '',
      });

      const geom = await adapter.getWindowGeometry('100');
      expect(geom).toEqual({
        windowId: '100',
        name: 'My Tauri App',
        x: 50,
        y: 100,
        width: 800,
        height: 600,
      });
    });

    it('throws when window ID not found', async () => {
      mockExec.mockResolvedValue({
        stdout: Buffer.from(JSON.stringify(swayTree)),
        stderr: '',
      });

      await expect(adapter.getWindowGeometry('999')).rejects.toThrow(
        'Window 999 not found in sway tree',
      );
    });
  });

  describe('captureWindow', () => {
    it('captures region using grim', async () => {
      const fakeImage = Buffer.from('fake-image');
      // First call: getWindowGeometry (swaymsg get_tree)
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from(JSON.stringify(swayTree)),
        stderr: '',
      });
      // Second call: grim capture
      mockExec.mockResolvedValueOnce({
        stdout: fakeImage,
        stderr: '',
      });

      const result = await adapter.captureWindow('100', 'png');
      expect(result).toBe(fakeImage);

      // Verify grim was called with correct region
      expect(mockExec).toHaveBeenCalledWith('grim', [
        '-g', '50,100 800x600',
        '-t', 'png',
        '-',
      ]);
    });
  });
});
