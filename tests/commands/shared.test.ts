import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

import { discoverBridge, discoverBridgesByPid } from '../../src/bridge/tokenDiscovery.js';
const mockDiscoverBridge = vi.mocked(discoverBridge);
const mockDiscoverBridgesByPid = vi.mocked(discoverBridgesByPid);

// Import after mocks are set up
import { resolveBridge, addBridgeOptions } from '../../src/commands/shared.js';

describe('shared', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveBridge', () => {
    it('returns BridgeClient with explicit --port and --token (skips discovery)', async () => {
      const client = await resolveBridge({ port: 8080, token: 'explicit-token' });

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridge).not.toHaveBeenCalled();
      expect(mockDiscoverBridgesByPid).not.toHaveBeenCalled();
    });

    it('auto-discovers bridge when no explicit options given', async () => {
      mockDiscoverBridge.mockResolvedValue({ port: 9090, token: 'discovered' });

      const client = await resolveBridge({});

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridge).toHaveBeenCalledOnce();
    });

    it('throws meaningful error when discovery fails', async () => {
      mockDiscoverBridge.mockResolvedValue(null);

      await expect(resolveBridge({})).rejects.toThrow('No bridge found');
    });

    it('merges explicit port with discovered token', async () => {
      mockDiscoverBridge.mockResolvedValue({ port: 9090, token: 'discovered' });

      const client = await resolveBridge({ port: 7777 });

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridge).toHaveBeenCalledOnce();
    });

    it('merges explicit token with discovered port', async () => {
      mockDiscoverBridge.mockResolvedValue({ port: 9090, token: 'discovered' });

      const client = await resolveBridge({ token: 'my-token' });

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridge).toHaveBeenCalledOnce();
    });

    it('uses discoverBridgesByPid when --pid is provided', async () => {
      const bridges = new Map([[1234, { port: 5555, token: 'pid-token' }]]);
      mockDiscoverBridgesByPid.mockResolvedValue(bridges);

      const client = await resolveBridge({ pid: 1234 });

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridgesByPid).toHaveBeenCalledOnce();
      expect(mockDiscoverBridge).not.toHaveBeenCalled();
    });

    it('throws when --pid not found, listing available bridges', async () => {
      const bridges = new Map([
        [1111, { port: 5555, token: 'token-a' }],
        [2222, { port: 6666, token: 'token-b' }],
      ]);
      mockDiscoverBridgesByPid.mockResolvedValue(bridges);

      await expect(resolveBridge({ pid: 9999 })).rejects.toThrow(
        /No bridge found for PID 9999/,
      );
      await expect(resolveBridge({ pid: 9999 })).rejects.toThrow(/PID 1111/);
      await expect(resolveBridge({ pid: 9999 })).rejects.toThrow(/PID 2222/);
    });

    it('throws when --pid not found and no bridges are running', async () => {
      mockDiscoverBridgesByPid.mockResolvedValue(new Map());

      await expect(resolveBridge({ pid: 9999 })).rejects.toThrow(
        /No running bridges found/,
      );
    });

    it('passes windowLabel to BridgeClient', async () => {
      mockDiscoverBridge.mockResolvedValue({ port: 9090, token: 'discovered' });

      const client = await resolveBridge({ windowLabel: 'overlay' });

      expect(client).toBeInstanceOf(BridgeClient);
    });

    it('explicit --port/--token skips discovery even when --pid is given', async () => {
      const client = await resolveBridge({ port: 8080, token: 'explicit', pid: 1234 });

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridge).not.toHaveBeenCalled();
      expect(mockDiscoverBridgesByPid).not.toHaveBeenCalled();
    });
  });

  describe('addBridgeOptions', () => {
    it('adds --port and --token options to a command', async () => {
      const { Command } = await import('commander');
      const cmd = new Command('test-cmd');

      addBridgeOptions(cmd);

      const portOpt = cmd.options.find((o) => o.long === '--port');
      const tokenOpt = cmd.options.find((o) => o.long === '--token');

      expect(portOpt).toBeDefined();
      expect(tokenOpt).toBeDefined();
    });

    it('adds --pid and --window-label options to a command', async () => {
      const { Command } = await import('commander');
      const cmd = new Command('test-cmd');

      addBridgeOptions(cmd);

      const pidOpt = cmd.options.find((o) => o.long === '--pid');
      const windowLabelOpt = cmd.options.find((o) => o.long === '--window-label');

      expect(pidOpt).toBeDefined();
      expect(windowLabelOpt).toBeDefined();
    });
  });
});
