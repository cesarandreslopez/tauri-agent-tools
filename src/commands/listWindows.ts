import { Command } from 'commander';
import type { PlatformAdapter, WindowListEntry } from '../types.js';
import { discoverBridgesByPid } from '../bridge/tokenDiscovery.js';

export function registerListWindows(
  program: Command,
  getAdapter: () => Promise<PlatformAdapter>,
): void {
  const cmd = new Command('list-windows')
    .description('List all visible windows, marking Tauri apps')
    .option('--json', 'Output as JSON')
    .option('--tauri', 'Only show Tauri app windows')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools list-windows
  $ tauri-agent-tools list-windows --tauri --json`);

  cmd.action(async (opts: { json?: boolean; tauri?: boolean }) => {
    const adapter = await getAdapter();
    const [windows, bridgesByPid] = await Promise.all([
      adapter.listWindows(),
      discoverBridgesByPid(),
    ]);

    let entries: WindowListEntry[] = windows.map((w) => {
      const bridge = w.pid ? bridgesByPid.get(w.pid) : undefined;
      return {
        ...w,
        tauri: !!bridge,
        bridge: bridge ?? undefined,
      };
    });

    if (opts.tauri) {
      entries = entries.filter((e) => e.tauri);
    }

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      console.log(opts.tauri ? 'No Tauri windows found.' : 'No windows found.');
      return;
    }

    // Table output
    const idWidth = Math.max(2, ...entries.map((e) => e.windowId.length));
    const pidWidth = Math.max(3, ...entries.map((e) => e.pid ? String(e.pid).length : 1));
    const nameWidth = Math.max(4, ...entries.map((e) => (e.name ?? '').length));

    const header = [
      'ID'.padEnd(idWidth),
      'PID'.padEnd(pidWidth),
      'NAME'.padEnd(nameWidth),
      'SIZE',
      'TAURI',
    ].join('  ');
    console.log(header);

    for (const e of entries) {
      const line = [
        e.windowId.padEnd(idWidth),
        (e.pid ? String(e.pid) : '-').padEnd(pidWidth),
        (e.name ?? '').padEnd(nameWidth),
        `${e.width}x${e.height}`,
        e.tauri ? `yes (port ${e.bridge!.port})` : 'no',
      ].join('  ');
      console.log(line);
    }
  });

  program.addCommand(cmd);
}
