import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { validateWindowId, exec } from '../../src/util/exec.js';

const mockExecFile = vi.mocked(execFile);

describe('exec utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateWindowId', () => {
    it('accepts a simple numeric ID', () => {
      expect(() => validateWindowId('12345')).not.toThrow();
    });

    it('accepts a single digit', () => {
      expect(() => validateWindowId('0')).not.toThrow();
    });

    it('accepts a large numeric ID', () => {
      expect(() => validateWindowId('999999999')).not.toThrow();
    });

    it('rejects an empty string', () => {
      expect(() => validateWindowId('')).toThrow();
    });

    it('rejects alphabetic characters', () => {
      expect(() => validateWindowId('abc')).toThrow();
    });

    it('rejects mixed alphanumeric', () => {
      expect(() => validateWindowId('123abc')).toThrow();
    });

    it('rejects hex-like IDs', () => {
      expect(() => validateWindowId('0x1a2b')).toThrow();
    });

    it('rejects command injection attempts with semicolons', () => {
      expect(() => validateWindowId('123; rm -rf /')).toThrow();
    });

    it('rejects command injection attempts with backticks', () => {
      expect(() => validateWindowId('`whoami`')).toThrow();
    });

    it('rejects command injection via $() substitution', () => {
      expect(() => validateWindowId('$(cat /etc/passwd)')).toThrow();
    });

    it('rejects strings with spaces', () => {
      expect(() => validateWindowId('123 456')).toThrow();
    });

    it('rejects negative numbers', () => {
      expect(() => validateWindowId('-1')).toThrow();
    });

    it('rejects strings with leading/trailing whitespace', () => {
      expect(() => validateWindowId(' 123 ')).toThrow();
    });

    it('rejects strings with newlines', () => {
      expect(() => validateWindowId('123\n456')).toThrow();
    });
  });

  describe('exec', () => {
    it('resolves with stdout and stderr on success', async () => {
      const stdoutBuf = Buffer.from('hello');
      const stderrBuf = Buffer.from('');

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as Function)(null, stdoutBuf, stderrBuf);
        return {} as ReturnType<typeof execFile>;
      });

      const result = await exec('echo', ['hello']);
      expect(result.stdout).toEqual(stdoutBuf);
      expect(result.stderr).toBe('');
    });

    it('rejects with stderr message on failure', async () => {
      const stderrBuf = Buffer.from('something went wrong');

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as Function)(new Error('exit code 1'), Buffer.from(''), stderrBuf);
        return {} as ReturnType<typeof execFile>;
      });

      await expect(exec('bad-cmd', [])).rejects.toThrow('bad-cmd failed: something went wrong');
    });

    it('rejects with error.message when stderr is empty', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as Function)(new Error('command not found'), Buffer.from(''), Buffer.from(''));
        return {} as ReturnType<typeof execFile>;
      });

      await expect(exec('missing', [])).rejects.toThrow('missing failed: command not found');
    });

    it('passes stdin to child process', async () => {
      const stdinData = Buffer.from('input data');
      const mockStdin = { end: vi.fn() };

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as Function)(null, Buffer.from('output'), Buffer.from(''));
        return { stdin: mockStdin } as unknown as ReturnType<typeof execFile>;
      });

      await exec('cat', [], { stdin: stdinData });
      expect(mockStdin.end).toHaveBeenCalledWith(stdinData);
    });

    it('passes timeout option to execFile', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        expect((opts as Record<string, unknown>).timeout).toBe(3000);
        (callback as Function)(null, Buffer.from(''), Buffer.from(''));
        return {} as ReturnType<typeof execFile>;
      });

      await exec('slow-cmd', ['arg'], { timeout: 3000 });
    });

    it('handles non-Buffer stderr gracefully', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as Function)(new Error('fail'), Buffer.from(''), undefined);
        return {} as ReturnType<typeof execFile>;
      });

      await expect(exec('cmd', [])).rejects.toThrow('cmd failed: fail');
    });
  });
});
