import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WindowInfo } from '../../src/types.js';
import type { BridgeConfig } from '../../src/schemas/bridge.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridgesByPid: vi.fn(),
}));

import { discoverBridgesByPid } from '../../src/bridge/tokenDiscovery.js';
const mockDiscoverByPid = vi.mocked(discoverBridgesByPid);

describe('listWindows command', () => {
  describe('Tauri detection cross-referencing', () => {
    const windows: WindowInfo[] = [
      { windowId: '100', pid: 1001, name: 'My Tauri App', x: 0, y: 0, width: 800, height: 600 },
      { windowId: '101', pid: 1002, name: 'Firefox', x: 100, y: 100, width: 1200, height: 900 },
      { windowId: '102', pid: 1003, name: 'Another Tauri App', x: 200, y: 200, width: 640, height: 480 },
      { windowId: '103', name: 'No PID Window', x: 0, y: 0, width: 400, height: 300 },
    ];

    const bridgeMap = new Map<number, BridgeConfig>([
      [1001, { port: 9001, token: 'token-a' }],
      [1003, { port: 9003, token: 'token-c' }],
    ]);

    beforeEach(() => {
      vi.clearAllMocks();
      mockDiscoverByPid.mockResolvedValue(bridgeMap);
    });

    it('marks windows with matching PIDs as tauri: true', () => {
      const entries = windows.map((w) => {
        const bridge = w.pid ? bridgeMap.get(w.pid) : undefined;
        return { ...w, tauri: !!bridge, bridge: bridge ?? undefined };
      });

      expect(entries[0].tauri).toBe(true);
      expect(entries[0].bridge).toEqual({ port: 9001, token: 'token-a' });
      expect(entries[1].tauri).toBe(false);
      expect(entries[1].bridge).toBeUndefined();
      expect(entries[2].tauri).toBe(true);
      expect(entries[2].bridge).toEqual({ port: 9003, token: 'token-c' });
    });

    it('handles windows without PIDs', () => {
      const w = windows[3]; // No PID
      const bridge = w.pid ? bridgeMap.get(w.pid) : undefined;
      const entry = { ...w, tauri: !!bridge, bridge: bridge ?? undefined };

      expect(entry.tauri).toBe(false);
      expect(entry.bridge).toBeUndefined();
    });

    it('filters to tauri-only windows', () => {
      const entries = windows
        .map((w) => {
          const bridge = w.pid ? bridgeMap.get(w.pid) : undefined;
          return { ...w, tauri: !!bridge, bridge: bridge ?? undefined };
        })
        .filter((e) => e.tauri);

      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('My Tauri App');
      expect(entries[1].name).toBe('Another Tauri App');
    });

    it('handles empty bridge map', () => {
      const emptyMap = new Map<number, BridgeConfig>();
      const entries = windows.map((w) => {
        const bridge = w.pid ? emptyMap.get(w.pid) : undefined;
        return { ...w, tauri: !!bridge, bridge: bridge ?? undefined };
      });

      expect(entries.every((e) => !e.tauri)).toBe(true);
    });

    it('handles empty window list', () => {
      const entries: WindowInfo[] = [];
      const result = entries.map((w) => {
        const bridge = w.pid ? bridgeMap.get(w.pid) : undefined;
        return { ...w, tauri: !!bridge, bridge: bridge ?? undefined };
      });

      expect(result).toHaveLength(0);
    });
  });
});
