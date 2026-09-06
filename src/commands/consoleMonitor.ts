import { Command } from 'commander';
import { consoleObserver, readObserver, closeObserver } from '../bridge/observers.js';
import { monitorFor } from '../util/monitor.js';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge, parseEnum, parsePositiveInt } from './shared.js';
import { ConsoleEntrySchema, ConsoleLevelSchema } from '../schemas/commands.js';
import type { ConsoleEntry } from '../schemas/commands.js';

function matchesLevel(entry: ConsoleEntry, level?: string): boolean {
  if (!level) return true;
  return entry.level === level;
}

function compileRegex(pattern: string, label: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    throw new Error(`Invalid ${label} regex: ${pattern}`);
  }
}

function formatConsoleEntry(entry: ConsoleEntry): string {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}`;
}

export function registerConsoleMonitor(program: Command): void {
  const cmd = new Command('console-monitor')
    .description('Monitor console output (log/warn/error/info/debug) in real-time')
    .option('--level <level>', 'Filter by level (log, warn, error, info, debug)')
    .option('--filter <regex>', 'Filter messages by regex pattern')
    .option('--interval <ms>', 'Poll interval in milliseconds', parsePositiveInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parsePositiveInt)
    .option('--json', 'Output one JSON object per line');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    level?: string;
    filter?: string;
    interval: number;
    duration?: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    if (opts.level) {
      parseEnum(ConsoleLevelSchema, opts.level, 'level');
    }

    const filterRegex = opts.filter ? compileRegex(opts.filter, 'filter') : undefined;

    const bridge = await resolveBridge(opts);
    const scripts = consoleObserver();
    try {
      const patchResult = await bridge.eval(scripts.patch);
      if (patchResult !== 'patched' && patchResult !== 'already_patched') throw new Error(`Observer setup failed: ${String(patchResult)}`);

      if (!opts.json) {
        console.error('Monitoring console output... (Ctrl+C to stop)');
      }

      await monitorFor(opts, async () => {
        const entries = z.array(ConsoleEntrySchema).parse(await readObserver(bridge, scripts));

        for (const entry of entries) {
          if (!matchesLevel(entry, opts.level)) continue;
          if (filterRegex && !filterRegex.test(entry.message)) continue;

          if (opts.json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatConsoleEntry(entry));
          }
        }
      });
    } finally {
      await closeObserver(bridge, scripts);
    }
  });

  program.addCommand(cmd);
}
