import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeClient } from '../bridge/client.js';
import { ConsoleEntrySchema } from '../schemas.js';
import type { ConsoleEntry } from '../schemas.js';

const PATCH_SCRIPT = `(() => {
  if (window.__tauriDevToolsConsolePatched) return 'already_patched';
  window.__tauriDevToolsOriginalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };
  window.__tauriDevToolsConsoleLogs = [];
  ['log', 'warn', 'error', 'info', 'debug'].forEach(function(level) {
    console[level] = function() {
      var args = Array.prototype.slice.call(arguments);
      var message = args.map(function(a) {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      }).join(' ');
      window.__tauriDevToolsConsoleLogs.push({
        level: level,
        message: message,
        timestamp: Date.now()
      });
      window.__tauriDevToolsOriginalConsole[level].apply(console, arguments);
    };
  });
  window.__tauriDevToolsConsolePatched = true;
  return 'patched';
})()`;

const DRAIN_SCRIPT = `(() => {
  var log = window.__tauriDevToolsConsoleLogs || [];
  window.__tauriDevToolsConsoleLogs = [];
  return JSON.stringify(log);
})()`;

const CLEANUP_SCRIPT = `(() => {
  if (window.__tauriDevToolsOriginalConsole) {
    ['log', 'warn', 'error', 'info', 'debug'].forEach(function(level) {
      console[level] = window.__tauriDevToolsOriginalConsole[level];
    });
    delete window.__tauriDevToolsOriginalConsole;
    delete window.__tauriDevToolsConsoleLogs;
    delete window.__tauriDevToolsConsolePatched;
  }
  return 'cleaned';
})()`;

function matchesLevel(entry: ConsoleEntry, level?: string): boolean {
  if (!level) return true;
  return entry.level === level;
}

function matchesTextFilter(message: string, filter?: string): boolean {
  if (!filter) return true;
  const regex = new RegExp(filter);
  return regex.test(message);
}

function formatConsoleEntry(entry: ConsoleEntry): string {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}`;
}

async function cleanup(bridge: BridgeClient): Promise<void> {
  try {
    await bridge.eval(CLEANUP_SCRIPT);
  } catch {
    // Best-effort cleanup
  }
}

export function registerConsoleMonitor(program: Command): void {
  const cmd = new Command('console-monitor')
    .description('Monitor console output (log/warn/error/info/debug) in real-time')
    .option('--level <level>', 'Filter by level (log, warn, error, info, debug)')
    .option('--filter <regex>', 'Filter messages by regex pattern')
    .option('--interval <ms>', 'Poll interval in milliseconds', parseInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parseInt)
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
    if (opts.level && !['log', 'warn', 'error', 'info', 'debug'].includes(opts.level)) {
      throw new Error(
        `Invalid level: ${opts.level}. Must be one of: log, warn, error, info, debug`,
      );
    }

    const bridge = await resolveBridge(opts);

    const patchResult = await bridge.eval(PATCH_SCRIPT);
    if (patchResult === 'already_patched') {
      // Already patched, continue monitoring
    }

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
      console.error('Monitoring console output... (Ctrl+C to stop)');
    }

    try {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, opts.interval));
        if (stopped) break;

        const raw = await bridge.eval(DRAIN_SCRIPT);
        const entries = z.array(ConsoleEntrySchema).parse(JSON.parse(String(raw)));

        for (const entry of entries) {
          if (!matchesLevel(entry, opts.level)) continue;
          if (!matchesTextFilter(entry.message, opts.filter)) continue;

          if (opts.json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatConsoleEntry(entry));
          }
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await cleanup(bridge);
    }
  });

  program.addCommand(cmd);
}
