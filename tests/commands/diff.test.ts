import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock exec and stat before imports
vi.mock('../../src/util/exec.js', () => ({
  exec: vi.fn(),
  validateWindowId: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/util/magick.js', () => ({
  magickCommand: vi.fn((sub: string) => Promise.resolve({ bin: sub, args: [] })),
}));

import { exec } from '../../src/util/exec.js';
import { stat } from 'node:fs/promises';

const mockExec = vi.mocked(exec);
const mockStat = vi.mocked(stat);

describe('Diff command', () => {
  describe('formatResult', () => {
    // Mirror the formatResult logic from diff.ts
    interface DiffResult {
      pixelsDifferent: number;
      totalPixels: number;
      percentDifferent: number;
      diffImage: string | null;
    }

    function formatResult(result: DiffResult): string {
      const lines = [
        `Pixels different: ${result.pixelsDifferent}`,
        `Total pixels:     ${result.totalPixels}`,
        `Difference:       ${result.percentDifferent.toFixed(3)}%`,
      ];
      if (result.diffImage) {
        lines.push(`Diff image:       ${result.diffImage}`);
      }
      return lines.join('\n');
    }

    it('formats zero-difference result', () => {
      const output = formatResult({
        pixelsDifferent: 0,
        totalPixels: 2073600,
        percentDifferent: 0,
        diffImage: null,
      });
      expect(output).toContain('Pixels different: 0');
      expect(output).toContain('Total pixels:     2073600');
      expect(output).toContain('Difference:       0.000%');
      expect(output).not.toContain('Diff image');
    });

    it('formats result with difference', () => {
      const output = formatResult({
        pixelsDifferent: 1500,
        totalPixels: 2073600,
        percentDifferent: 0.07233,
        diffImage: null,
      });
      expect(output).toContain('Pixels different: 1500');
      expect(output).toContain('Difference:       0.072%');
    });

    it('includes diff image path when provided', () => {
      const output = formatResult({
        pixelsDifferent: 100,
        totalPixels: 1000,
        percentDifferent: 10,
        diffImage: '/tmp/diff.png',
      });
      expect(output).toContain('Diff image:       /tmp/diff.png');
    });
  });

  describe('percentage calculation', () => {
    it('computes correct percentage', () => {
      const pixelsDifferent = 500;
      const totalPixels = 2073600; // 1920x1080
      const percent = (pixelsDifferent / totalPixels) * 100;
      expect(percent).toBeCloseTo(0.02411, 4);
    });

    it('returns zero when totalPixels is zero', () => {
      const totalPixels = 0;
      const percent = totalPixels > 0 ? (100 / totalPixels) * 100 : 0;
      expect(percent).toBe(0);
    });
  });

  describe('command integration', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls identify with correct args', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('1920 1080'),
        stderr: '',
      });
      // compare succeeds (identical images)
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: '0',
      });

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '/tmp/a.png', '/tmp/b.png']);
      logSpy.mockRestore();

      expect(mockExec).toHaveBeenCalledWith('identify', ['-format', '%w %h', '/tmp/a.png']);
    });

    it('calls compare with correct args', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: '0',
      });

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '/tmp/a.png', '/tmp/b.png']);
      logSpy.mockRestore();

      expect(mockExec).toHaveBeenCalledWith('compare', [
        '-metric', 'AE',
        '/tmp/a.png', '/tmp/b.png',
        '/dev/null',
      ]);
    });

    it('uses output path when provided', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: '0',
      });

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '/tmp/a.png', '/tmp/b.png', '-o', '/tmp/diff.png']);
      logSpy.mockRestore();

      expect(mockExec).toHaveBeenCalledWith('compare', [
        '-metric', 'AE',
        '/tmp/a.png', '/tmp/b.png',
        '/tmp/diff.png',
      ]);
    });

    it('parses pixel count from compare stderr on exit code 1', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      // compare exits 1 — exec wrapper throws with stderr in message
      mockExec.mockRejectedValueOnce(new Error('compare failed: 42'));

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '--json', '/tmp/a.png', '/tmp/b.png']);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      logSpy.mockRestore();

      expect(output.pixelsDifferent).toBe(42);
      expect(output.totalPixels).toBe(10000);
      expect(output.percentDifferent).toBeCloseTo(0.42, 2);
    });

    it('throws when file does not exist', async () => {
      mockStat.mockRejectedValueOnce(new Error('ENOENT'));

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      program.exitOverride();
      registerDiff(program);

      await expect(
        program.parseAsync(['node', 'test', 'diff', '/tmp/missing.png', '/tmp/b.png']),
      ).rejects.toThrow('File not found: /tmp/missing.png');
    });

    it('throws when identify fails and threshold is set', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockRejectedValueOnce(new Error('identify not found'));

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      program.exitOverride();
      registerDiff(program);

      await expect(
        program.parseAsync(['node', 'test', 'diff', '--threshold', '1', '/tmp/a.png', '/tmp/b.png']),
      ).rejects.toThrow('Cannot compute percentage');
    });

    it('sets exit code 1 when threshold is exceeded', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      mockExec.mockRejectedValueOnce(new Error('compare failed: 500'));

      const originalExitCode = process.exitCode;
      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '--threshold', '1', '/tmp/a.png', '/tmp/b.png']);
      logSpy.mockRestore();

      // 500 / 10000 = 5% > 1% threshold
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });

    it('outputs JSON when --json flag is set', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: '0',
      });

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '--json', '/tmp/a.png', '/tmp/b.png']);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      logSpy.mockRestore();

      expect(output).toHaveProperty('pixelsDifferent');
      expect(output).toHaveProperty('totalPixels');
      expect(output).toHaveProperty('percentDifferent');
      expect(output).toHaveProperty('diffImage');
    });

    it('re-throws when compare fails with non-numeric error', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      // compare fails with a real error (e.g., incompatible image sizes)
      mockExec.mockRejectedValueOnce(new Error('compare failed: images have different sizes'));

      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      program.exitOverride();
      registerDiff(program);

      await expect(
        program.parseAsync(['node', 'test', 'diff', '/tmp/a.png', '/tmp/b.png']),
      ).rejects.toThrow();
    });

    it('does not set exit code when under threshold', async () => {
      mockStat.mockResolvedValue({} as any);
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.from('100 100'),
        stderr: '',
      });
      // 5 pixels different out of 10000 = 0.05%
      mockExec.mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: '5',
      });

      const originalExitCode = process.exitCode;
      const { Command } = await import('commander');
      const { registerDiff } = await import('../../src/commands/diff.js');
      const program = new Command();
      registerDiff(program);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await program.parseAsync(['node', 'test', 'diff', '--threshold', '1', '/tmp/a.png', '/tmp/b.png']);
      logSpy.mockRestore();

      // 0.05% < 1% threshold — should NOT set exit code
      expect(process.exitCode).not.toBe(1);
      process.exitCode = originalExitCode;
    });
  });
});
