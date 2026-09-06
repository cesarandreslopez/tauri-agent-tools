import { Command } from 'commander';
import { ipcObserver, readObserver, closeObserver } from '../bridge/observers.js';
import { monitorFor, createSignalScope } from '../util/monitor.js';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge, parsePositiveInt } from './shared.js';
import { IpcEntrySchema } from '../schemas/commands.js';
import type { IpcEntry } from '../schemas/commands.js';

const legacyScripts = ipcObserver('legacy');
export const PATCH_SCRIPT = legacyScripts.patch;
export const DRAIN_SCRIPT = legacyScripts.drain;
export const CLEANUP_SCRIPT = legacyScripts.cleanup;

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

export function registerIpcMonitor(program: Command): void {
  const cmd = new Command('ipc-monitor')
    .description('Monitor Tauri IPC calls using temporary instrumentation')
    .option('--filter <command>', 'Only show specific IPC commands (supports * wildcards)')
    .option('--interval <ms>', 'Poll interval in milliseconds', parsePositiveInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parsePositiveInt)
    .option('--slow <ms>', 'Flag IPC calls that completed but took ≥ N ms', parsePositiveInt)
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
    const scripts = ipcObserver();
    const signals = createSignalScope();
    try {
      const patchResult = await bridge.eval(scripts.patch);
      if (patchResult === 'no_tauri') throw new Error('Tauri invoke API not found. Expected window.__TAURI_INTERNALS__.invoke or window.__TAURI__.core.invoke.');
      if (patchResult !== 'patched' && patchResult !== 'already_patched') throw new Error(`Observer setup failed: ${String(patchResult)}`);

      if (!opts.json) {
        console.error('Monitoring IPC calls... (Ctrl+C to stop)');
      }

      await monitorFor({ ...opts, signal: signals.signal }, async () => {
        const entries = z.array(IpcEntrySchema).parse(await readObserver(bridge, scripts));

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
      });
    } finally {
      await closeObserver(bridge, scripts);
      signals.dispose();
      if (opts.stats) renderStats(stats);
    }
  });

  program.addCommand(cmd);
}
