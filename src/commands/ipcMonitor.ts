import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge, parseIntArg } from './shared.js';
import type { BridgeClient } from '../bridge/client.js';
import { IpcEntrySchema } from '../schemas/commands.js';
import type { IpcEntry } from '../schemas/commands.js';

export const PATCH_SCRIPT = `(() => {
  if (window.__tauriDevToolsPatched) return 'already_patched';
  function getInvokeTarget() {
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return { owner: window.__TAURI_INTERNALS__, invoke: window.__TAURI_INTERNALS__.invoke };
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return { owner: window.__TAURI__.core, invoke: window.__TAURI__.core.invoke };
    }
    return null;
  }
  var target = getInvokeTarget();
  if (!target) {
    return 'no_tauri';
  }
  window.__tauriDevToolsOriginalInvoke = target.invoke;
  window.__tauriDevToolsInvokeOwner = target.owner;
  window.__tauriDevToolsIpcLog = [];
  target.owner.invoke = function(cmd, args, options) {
    var entry = { command: cmd, args: args || {}, timestamp: Date.now() };
    var start = performance.now();
    return window.__tauriDevToolsOriginalInvoke.call(this, cmd, args, options).then(function(result) {
      entry.duration = Math.round(performance.now() - start);
      entry.result = result;
      window.__tauriDevToolsIpcLog.push(entry);
      return result;
    }).catch(function(err) {
      entry.duration = Math.round(performance.now() - start);
      entry.error = err && err.message ? err.message : String(err);
      window.__tauriDevToolsIpcLog.push(entry);
      throw err;
    });
  };
  window.__tauriDevToolsPatched = true;
  return 'patched';
})()`;

export const DRAIN_SCRIPT = `(() => {
  var log = window.__tauriDevToolsIpcLog || [];
  window.__tauriDevToolsIpcLog = [];
  return JSON.stringify(log);
})()`;

export const CLEANUP_SCRIPT = `(() => {
  if (window.__tauriDevToolsOriginalInvoke && window.__tauriDevToolsInvokeOwner) {
    window.__tauriDevToolsInvokeOwner.invoke = window.__tauriDevToolsOriginalInvoke;
    delete window.__tauriDevToolsOriginalInvoke;
    delete window.__tauriDevToolsInvokeOwner;
    delete window.__tauriDevToolsIpcLog;
    delete window.__tauriDevToolsPatched;
  }
  return 'cleaned';
})()`;

function escapeRegExp(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function compileWildcardFilter(filter: string): RegExp | null {
  if (!filter.includes('*')) return null;
  const pattern = '^' + filter.split('*').map(escapeRegExp).join('.*') + '$';
  return new RegExp(pattern);
}

function formatEntry(entry: IpcEntry, slow = false): string {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  const dur = entry.duration !== undefined ? ` ${entry.duration}ms` : '';
  const status = entry.error ? `ERR: ${entry.error}` : 'OK';
  const slowMark = slow ? ' SLOW' : '';
  return `[${time}]${dur} ${entry.command} ${status}${slowMark}`;
}

interface CommandStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

function renderStats(stats: Map<string, CommandStat>): void {
  if (stats.size === 0) {
    console.error('# no IPC calls observed');
    return;
  }
  const rows = [...stats.entries()].sort((a, b) => b[1].maxMs - a[1].maxMs);
  console.error('# IPC summary (by slowest):');
  for (const [command, s] of rows) {
    const avg = s.count > 0 ? Math.round(s.totalMs / s.count) : 0;
    const errPart = s.errors > 0 ? `  errors=${s.errors}` : '';
    console.error(`#   ${command.padEnd(28)} n=${s.count}  max=${s.maxMs}ms  avg=${avg}ms${errPart}`);
  }
}

async function cleanup(bridge: BridgeClient): Promise<void> {
  try {
    await bridge.eval(CLEANUP_SCRIPT);
  } catch {
    // Best-effort cleanup
  }
}

export function registerIpcMonitor(program: Command): void {
  const cmd = new Command('ipc-monitor')
    .description('Monitor Tauri IPC calls in real-time (read-only)')
    .option('--filter <command>', 'Only show specific IPC commands (supports * wildcards)')
    .option('--interval <ms>', 'Poll interval in milliseconds', parseIntArg, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parseIntArg)
    .option('--slow <ms>', 'Flag IPC calls that completed but took ≥ N ms', parseIntArg)
    .option('--stats', 'Print a per-command latency summary on exit')
    .option('--json', 'Output one JSON object per line');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    filter?: string;
    interval: number;
    duration?: number;
    slow?: number;
    stats?: boolean;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const filterRegex = opts.filter ? compileWildcardFilter(opts.filter) : null;
    const stats = new Map<string, CommandStat>();

    const bridge = await resolveBridge(opts);

    // Inject the monkey-patch
    const patchResult = await bridge.eval(PATCH_SCRIPT);
    if (patchResult === 'no_tauri') {
      throw new Error(
        'Tauri invoke API not found. Expected window.__TAURI_INTERNALS__.invoke or window.__TAURI__.core.invoke.',
      );
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
      console.error('Monitoring IPC calls... (Ctrl+C to stop)');
    }

    try {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, opts.interval));
        if (stopped) break;

        const raw = await bridge.eval(DRAIN_SCRIPT);
        const entries = z.array(IpcEntrySchema).parse(JSON.parse(String(raw)));

        for (const entry of entries) {
          if (opts.filter) {
            if (filterRegex) {
              if (!filterRegex.test(entry.command)) continue;
            } else if (entry.command !== opts.filter) {
              continue;
            }
          }

          if (opts.stats) {
            const s = stats.get(entry.command) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
            s.count += 1;
            if (entry.error) s.errors += 1;
            if (entry.duration !== undefined) {
              s.totalMs += entry.duration;
              if (entry.duration > s.maxMs) s.maxMs = entry.duration;
            }
            stats.set(entry.command, s);
          }

          const isSlow =
            opts.slow !== undefined &&
            entry.duration !== undefined &&
            entry.duration >= opts.slow;

          if (opts.json) {
            console.log(JSON.stringify(isSlow ? { ...entry, slow: true } : entry));
          } else {
            console.log(formatEntry(entry, isSlow));
          }
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await cleanup(bridge);
      if (opts.stats) renderStats(stats);
    }
  });

  program.addCommand(cmd);
}
