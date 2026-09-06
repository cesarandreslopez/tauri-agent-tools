import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerWait } from '../../src/commands/wait.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
}));

describe('Wait command', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride(); // Throw instead of process.exit
    const mockAdapter = {
      findWindow: vi.fn(),
      captureWindow: vi.fn(),
      getWindowGeometry: vi.fn(),
      getWindowName: vi.fn(),
      listWindows: vi.fn(),
    };
    registerWait(program, () => mockAdapter);
    return { program, mockAdapter };
  }

  describe('option validation', () => {
    it('requires at least one of --selector, --eval, or --title', async () => {
      const { program } = createProgram();

      await expect(
        program.parseAsync(['node', 'test', 'wait']),
      ).rejects.toThrow('One of --selector, --eval, or --title is required');
    });
  });

  describe('title mode (no bridge)', () => {
    it('returns window ID when found immediately', async () => {
      const { program, mockAdapter } = createProgram();
      mockAdapter.findWindow.mockResolvedValue('12345');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync([
        'node', 'test', 'wait', '--title', 'My App',
      ]);

      expect(mockAdapter.findWindow).toHaveBeenCalledWith('My App');
      expect(consoleSpy).toHaveBeenCalledWith('12345');

      consoleSpy.mockRestore();
    });

    it('throws on timeout when window never appears', async () => {
      const { program, mockAdapter } = createProgram();
      mockAdapter.findWindow.mockRejectedValue(new Error('not found'));

      await expect(program.parseAsync(['node','test','wait','--title','Missing','--timeout','20','--interval','5']))
        .rejects.toThrow('Timed out waiting for window: Missing');

      vi.restoreAllMocks();
    });
  });

  describe('command registration', () => {
    it('registers wait command with expected options', () => {
      const { program } = createProgram();
      const waitCmd = program.commands.find((c) => c.name() === 'wait')!;

      expect(waitCmd).toBeDefined();
      expect(waitCmd.description()).toBe('Wait for a condition to be met');

      const optionNames = waitCmd.options.map((o) => o.long);
      expect(optionNames).toContain('--selector');
      expect(optionNames).toContain('--eval');
      expect(optionNames).toContain('--title');
      expect(optionNames).toContain('--timeout');
      expect(optionNames).toContain('--interval');
      expect(optionNames).toContain('--port');
      expect(optionNames).toContain('--token');
    });
  });
});
