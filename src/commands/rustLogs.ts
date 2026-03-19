import { Command } from 'commander';
import { addBridgeOptions, resolveBridge, parseEnum } from './shared.js';
import { RustLogLevelSchema } from '../schemas/bridge.js';
import type { RustLogEntry } from '../schemas/bridge.js';

function matchesLevel(entry: RustLogEntry, level?: string): boolean {
  if (!level) return true;
  const levels = RustLogLevelSchema.options;
  const threshold = levels.indexOf(level as typeof levels[number]);
  if (threshold === -1) return true;
  const entryLevel = levels.indexOf(entry.level);
  return entryLevel >= threshold;
}

function compileRegex(pattern: string, label: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    throw new Error(`Invalid ${label} regex: ${pattern}`);
  }
}

function matchesSource(entry: RustLogEntry, source?: string): boolean {
  if (!source || source === 'all') return true;
  if (source === 'rust') return entry.source === 'rust';
  if (source === 'sidecar') return entry.source.startsWith('sidecar:');
  return entry.source === source;
}

function formatLogEntry(entry: RustLogEntry): string {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  const level = entry.level.toUpperCase();
  if (entry.source !== 'rust') {
    return `[${time}] [${level}] [${entry.source}] ${entry.target}: ${entry.message}`;
  }
  return `[${time}] [${level}] ${entry.target}: ${entry.message}`;
}

export function registerRustLogs(program: Command): void {
  const cmd = new Command('rust-logs')
    .description('Monitor Rust backend logs and sidecar output in real-time')
    .option('--level <level>', 'Minimum log level: trace, debug, info, warn, error')
    .option('--target <regex>', 'Filter by Rust module path (regex)')
    .option('--source <source>', 'Filter by source: rust, sidecar, all, or sidecar:<name>', 'all')
    .option('--filter <regex>', 'Filter messages by regex pattern')
    .option('--interval <ms>', 'Poll interval in milliseconds', parseInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parseInt)
    .option('--json', 'Output one JSON object per line');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    level?: string;
    target?: string;
    source: string;
    filter?: string;
    interval: number;
    duration?: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    if (opts.level) {
      parseEnum(RustLogLevelSchema, opts.level, 'level');
    }

    const targetRegex = opts.target ? compileRegex(opts.target, 'target') : undefined;
    const filterRegex = opts.filter ? compileRegex(opts.filter, 'filter') : undefined;

    const bridge = await resolveBridge(opts);

    let stopped = false;

    const onSignal = () => {
      stopped = true;
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.duration) {
      timer = setTimeout(() => {
        stopped = true;
      }, opts.duration);
    }

    if (!opts.json) {
      console.error('Monitoring Rust logs... (Ctrl+C to stop)');
    }

    try {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, opts.interval));
        if (stopped) break;

        const entries: RustLogEntry[] = await bridge.fetchLogs();

        for (const entry of entries) {
          if (!matchesLevel(entry, opts.level)) continue;
          if (targetRegex && !targetRegex.test(entry.target)) continue;
          if (!matchesSource(entry, opts.source)) continue;
          if (filterRegex && !filterRegex.test(entry.message)) continue;

          if (opts.json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatLogEntry(entry));
          }
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  });

  program.addCommand(cmd);
}
