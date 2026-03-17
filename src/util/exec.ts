import { execFile as cpExecFile } from 'node:child_process';

const MAX_BUFFER = 100 * 1024 * 1024; // 100MB
const WINDOW_ID_RE = /^\d+$/;

export function validateWindowId(id: string): void {
  if (!WINDOW_ID_RE.test(id)) {
    throw new Error(`Invalid window ID: ${id}`);
  }
}

export interface ExecResult {
  stdout: Buffer;
  stderr: string;
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
          reject(new Error(`${cmd} failed: ${stderrStr || error.message}`));
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
