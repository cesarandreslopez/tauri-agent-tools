import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeClient } from '../bridge/client.js';
import { IpcEntrySchema } from '../schemas/commands.js';
import type { IpcEntry } from '../schemas/commands.js';

const PATCH_SCRIPT = `(() => {
  if (window.__tauriDevToolsPatched) return 'already_patched';
  if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
    return 'no_tauri';
  }
  window.__tauriDevToolsOriginalInvoke = window.__TAURI__.core.invoke;
  window.__tauriDevToolsIpcLog = [];
  window.__TAURI__.core.invoke = function(cmd, args) {
    var entry = { command: cmd, args: args || {}, timestamp: Date.now() };
    var start = performance.now();
    return window.__tauriDevToolsOriginalInvoke.call(this, cmd, args).then(function(result) {
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

const DRAIN_SCRIPT = `(() => {
  var log = window.__tauriDevToolsIpcLog || [];
  window.__tauriDevToolsIpcLog = [];
  return JSON.stringify(log);
})()`;

const CLEANUP_SCRIPT = `(() => {
  if (window.__tauriDevToolsOriginalInvoke) {
    window.__TAURI__.core.invoke = window.__tauriDevToolsOriginalInvoke;
    delete window.__tauriDevToolsOriginalInvoke;
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

function formatEntry(entry: IpcEntry): string {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  const dur = entry.duration !== undefined ? ` ${entry.duration}ms` : '';
  const status = entry.error ? `ERR: ${entry.error}` : 'OK';
  return `[${time}]${dur} ${entry.command} ${status}`;
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
    .option('--interval <ms>', 'Poll interval in milliseconds', parseInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parseInt)
    .option('--json', 'Output one JSON object per line');

  addBridgeOptions(cmd);

  cmd.action(async (opts: {
    filter?: string;
    interval: number;
    duration?: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const filterRegex = opts.filter ? compileWildcardFilter(opts.filter) : null;

    const bridge = await resolveBridge(opts);

    // Inject the monkey-patch
    const patchResult = await bridge.eval(PATCH_SCRIPT);
    if (patchResult === 'no_tauri') {
      throw new Error(
        'window.__TAURI__.core.invoke not found. Is this a Tauri app with IPC enabled?',
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

          if (opts.json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatEntry(entry));
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
