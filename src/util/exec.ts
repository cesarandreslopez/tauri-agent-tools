import { execFile as cpExecFile } from 'node:child_process';
import { WindowIdSchema } from '../schemas/platform.js';

const MAX_BUFFER = 100 * 1024 * 1024; // 100MB

export function validateWindowId(id: string): void {
  WindowIdSchema.parse(id);
}

export interface ExecResult {
  stdout: Buffer;
  stderr: string;
}

export class ExecError extends Error {
  constructor(
    message: string,
    public readonly code: number | string | null | undefined,
    public readonly stdout: Buffer,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'ExecError';
  }
}

export function exec(
  cmd: string,
  args: string[],
  options?: { stdin?: Buffer; timeout?: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = cpExecFile(
      cmd,
      args,
      {
        maxBuffer: MAX_BUFFER,
        encoding: 'buffer',
        timeout: options?.timeout,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrStr = Buffer.isBuffer(stderr) ? stderr.toString() : String(stderr ?? '');
          reject(new ExecError(`${cmd} failed: ${stderrStr || error.message}`, error.code,
            Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''), stderrStr));
          return;
        }
        resolve({
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as unknown as string),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString() : String(stderr ?? ''),
        });
      },
    );

    if (options?.stdin && child.stdin) {
      child.stdin.end(options.stdin);
    }
  });
}
