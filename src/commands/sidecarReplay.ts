import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

interface SidecarReplayOpts {
  toStdout?: boolean;
  toExec?: string;
  rate?: string;
  loop?: boolean;
}

/**
 * Register the `sidecar` parent command's `replay` subcommand alongside `tap`.
 * Note: this file does NOT define a top-level "sidecar" parent — that lives in
 * sidecarTap.ts. Instead we expose a helper that the CLI bootstrap composes.
 */
export function registerSidecarReplay(program: Command): void {
  // Find the existing "sidecar" parent command registered by sidecarTap.
  const sidecar = program.commands.find((c) => c.name() === 'sidecar');
  if (!sidecar) {
    throw new Error('registerSidecarReplay must run after registerSidecarTap');
  }

  sidecar
    .command('replay')
    .description('Replay a recorded NDJSON stream (from `sidecar tap --record`)')
    .argument('<file>', 'Path to NDJSON file produced by `sidecar tap --record`')
    .option('--to-stdout', 'Emit lines verbatim to stdout (default)')
    .option('--to-exec <cmd>', 'Pipe lines into the stdin of this command (split with spaces for args)')
    .option('--rate <lps>', 'Lines per second (default: unlimited — emit as fast as possible)')
    .option('--loop', 'After EOF, restart the file from the top until interrupted')
    .action(async (file: string, opts: SidecarReplayOpts) => {
      if (!existsSync(file)) {
        throw new Error(`Recording file not found: ${file}`);
      }
      const rate = opts.rate ? parseRate(opts.rate) : Number.POSITIVE_INFINITY;
      const delayMs = Number.isFinite(rate) ? Math.round(1000 / rate) : 0;

      const lines = (await readFile(file, 'utf-8'))
        .split(/\r?\n/)
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        process.stderr.write(`[sidecar-replay] recording is empty: ${file}\n`);
        return;
      }

      if (opts.toExec) {
        await replayToExec(lines, opts.toExec, delayMs, opts.loop ?? false);
      } else {
        await replayToStdout(lines, delayMs, opts.loop ?? false);
      }
    });
}

function parseRate(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--rate must be a positive number (lines per second), got: ${input}`);
  }
  return n;
}

async function replayToStdout(lines: string[], delayMs: number, loop: boolean): Promise<void> {
  do {
    for (const line of lines) {
      process.stdout.write(line + '\n');
      if (delayMs > 0) await sleep(delayMs);
    }
  } while (loop);
}

async function replayToExec(
  lines: string[],
  cmdLine: string,
  delayMs: number,
  loop: boolean,
): Promise<void> {
  // Naive whitespace split. Users with quoted args should pre-tokenize via shell.
  const [exec, ...args] = cmdLine.split(/\s+/);
  if (!exec) throw new Error('--to-exec must include a command');
  const child = spawn(exec, args, { stdio: ['pipe', 'inherit', 'inherit'] });

  const closed = new Promise<number>((resolve, reject) => {
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve(code ?? 0));
  });

  try {
    do {
      for (const line of lines) {
        if (!child.stdin.write(line + '\n')) {
          await new Promise<void>((r) => child.stdin.once('drain', r));
        }
        if (delayMs > 0) await sleep(delayMs);
      }
    } while (loop);
    child.stdin.end();
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }

  const exitCode = await closed;
  if (exitCode !== 0) process.exitCode = exitCode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
