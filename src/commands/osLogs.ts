import { Command } from 'commander';
import { parsePositiveInt } from './shared.js';
import { spawn } from 'node:child_process';
import * as darwin from '../platform/oslog/darwin.js';
import * as linux from '../platform/oslog/linux.js';
import * as windows from '../platform/oslog/windows.js';
import type { NormalizedLogEntry, OsLogLevel } from '../schemas/osLog.js';
import { resolveTauriProject } from '../util/tauriConfig.js';
import { LineFramer } from '../util/ndjson.js';

interface OsLogsOpts {
  config?: string;
  identifier?: string;
  productName?: string;
  since?: string;
  level?: string;
  source?: string;
  duration?: string;
  json?: boolean;
}

const LEVEL_RANK: Record<OsLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function registerOsLogs(program: Command): void {
  const cmd = new Command('os-logs')
    .description("Tail the host OS's log stream filtered to a Tauri bundle id")
    .option('--config <path>', 'Path to tauri.conf.json (or its directory). Auto-detected if omitted.')
    .option('--identifier <id>', 'Bundle identifier override')
    .option('--product-name <name>', 'Product name override (used for log-source matching)')
    .option('--since <duration>', 'How far back to start (e.g., 5m, 1h). Linux only.')
    .option('--level <level>', 'Minimum level: debug | info | warn | error')
    .option('--source <source>', 'Filter source: main | webview | sidecar | all', 'all')
    .option('--duration <ms>', 'Stop after N milliseconds', parseIntOrInfinity)
    .option('--json', 'Output as one NDJSON envelope per line (default)')
    .action(async (opts: OsLogsOpts) => {
      const minLevel = opts.level ? validateLevel(opts.level) : null;
      const sourceFilter = opts.source ?? 'all';

      let identifier: string;
      let productName: string;
      if (opts.identifier) {
        identifier = opts.identifier;
        productName = opts.productName ?? opts.identifier;
      } else {
        const resolved = await resolveTauriProject({ configPath: opts.config });
        identifier = resolved.identifier;
        productName = opts.productName ?? resolved.productName;
      }

      const adapter = pickAdapter();
      const args = adapter.buildArgs({
        identifier,
        productName,
        since: opts.since,
      });

      const child = spawn(adapter.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const framer = new LineFramer();
      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (chunk: string) => {
        for (const line of framer.push(chunk)) {
          handleLine(line, adapter, minLevel, sourceFilter);
        }
      });

      let stderrBuf = '';
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk: string) => {
        stderrBuf += chunk;
        if (stderrBuf.length > 1024 * 16) stderrBuf = stderrBuf.slice(-1024 * 16);
      });

      let timeoutHandle: NodeJS.Timeout | null = null;
      if (opts.duration && Number.isFinite(opts.duration as unknown as number)) {
        timeoutHandle = setTimeout(() => child.kill('SIGTERM'), opts.duration as unknown as number);
      }

      await new Promise<void>((resolve, reject) => {
        child.on('error', (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new Error(
                `${adapter.command} not found on PATH. ` +
                  `os-logs needs the host OS's log streaming tool.`,
              ),
            );
            return;
          }
          reject(err);
        });
        child.on('close', (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          const trailing = framer.flush();
          if (trailing) handleLine(trailing, adapter, minLevel, sourceFilter);
          // Non-zero exits from `log stream` on SIGTERM are expected; only fail
          // if we got nothing meaningful and stderr has content.
          if (code && code !== 0 && code !== 143 /* SIGTERM */) {
            const detail = stderrBuf.trim();
            reject(new Error(`${adapter.command} exited with code ${code}${detail ? `: ${detail}` : ''}`));
            return;
          }
          resolve();
        });
      });
    });

  program.addCommand(cmd);
}

interface OsLogAdapter {
  command: string;
  buildArgs: (a: { identifier: string; productName: string; since?: string }) => string[];
  parseLine: (line: string) => NormalizedLogEntry | null;
}

function pickAdapter(): OsLogAdapter {
  if (process.platform === 'darwin') {
    return { command: darwin.COMMAND, buildArgs: darwin.buildArgs, parseLine: darwin.parseLine };
  }
  if (process.platform === 'linux') {
    return { command: linux.COMMAND, buildArgs: linux.buildArgs, parseLine: linux.parseLine };
  }
  if (process.platform === 'win32') {
    return { command: windows.COMMAND, buildArgs: windows.buildArgs, parseLine: windows.parseLine };
  }
  throw new Error(`os-logs is not supported on platform: ${process.platform}`);
}

function handleLine(
  line: string,
  adapter: OsLogAdapter,
  minLevel: OsLogLevel | null,
  sourceFilter: string,
): void {
  if (line.length === 0) return;
  const entry = adapter.parseLine(line);
  if (!entry) return;
  if (minLevel && LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) return;
  if (sourceFilter !== 'all' && entry.source !== sourceFilter) return;
  console.log(JSON.stringify(entry));
}

function validateLevel(input: string): OsLogLevel {
  if (input === 'debug' || input === 'info' || input === 'warn' || input === 'error') {
    return input;
  }
  throw new Error(`Invalid --level: ${input}. Expected one of: debug, info, warn, error.`);
}

function parseIntOrInfinity(value: string): number {
  if (value === 'infinity' || value === 'inf') return Number.POSITIVE_INFINITY;
  return parsePositiveInt(value);
}
