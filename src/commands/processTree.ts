import { Command } from 'commander';
import {
  addBridgeOptions,
  resolveBridge,
  endpointAvailable,
  endpointUnavailableNote,
} from './shared.js';
import type { BridgeOpts } from './shared.js';
import { discoverBridge, discoverBridgesByPid } from '../bridge/tokenDiscovery.js';
import { snapshotProcesses, buildDescendantTree, countDescendants } from '../util/psTree.js';
import type { PsTreeNode } from '../util/psTree.js';
import type { ProcessResponse } from '../schemas/bridge.js';

interface ProcessTreeOpts extends BridgeOpts {
  json?: boolean;
  deep?: boolean;
}

export function registerProcessTree(program: Command): void {
  const cmd = new Command('process-tree')
    .description(
      'Show the Tauri PID and its sidecars. Uses bridge /process (v0.7+); ' +
        '--deep walks the real OS descendant tree (sidecar grandchildren, workers) without the bridge.',
    )
    .option(
      '--deep',
      'Walk the full OS process descendant tree via `ps` (includes unregistered grandchildren); works without bridge /process',
    )
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: ProcessTreeOpts) => {
    // --deep: OS-level descendant walk, independent of the bridge entirely.
    // With an explicit --pid it needs no bridge at all; otherwise it resolves
    // the app PID from a discoverable bridge token file.
    if (opts.deep) {
      const appPid = await resolveAppPid(opts);
      if (appPid === null) {
        throw new Error(
          'process-tree --deep needs the app PID. Pass --pid <n>, or run it where a bridge token file is discoverable.',
        );
      }
      await renderDeep(appPid, opts);
      return;
    }

    const bridge = await resolveBridge(opts);

    // Default path: bridge /process. On older bridges this endpoint is absent.
    if (!(await endpointAvailable(bridge, '/process', opts))) {
      // Degrade where we can: fall back to the OS walk if the app PID is
      // resolvable; otherwise re-raise the actionable "needs v0.7" error so the
      // upgrade hint is preserved.
      const appPid = await resolveAppPid(opts);
      if (appPid === null) {
        await bridge.process(); // throws requireEndpoint('/process') with upgrade hint
        return; // unreachable
      }
      if (!opts.json) {
        const v = (await bridge.version())?.version;
        console.error(
          `note: ${endpointUnavailableNote('/process', v)} Falling back to the OS process walk (as --deep).`,
        );
      }
      await renderDeep(appPid, opts);
      return;
    }

    const proc = await bridge.process();
    if (opts.json) {
      console.log(JSON.stringify(proc, null, 2));
      return;
    }
    renderHuman(proc);
  });

  program.addCommand(cmd);
}

/**
 * Resolve the target app PID for the OS-level walk:
 *  - explicit `--pid` wins;
 *  - explicit `--port` matches a discovered bridge token by port (strictly — no
 *    silent first-bridge fallback, so an unknown port resolves to null);
 *  - otherwise the first/only discoverable bridge.
 */
async function resolveAppPid(opts: BridgeOpts): Promise<number | null> {
  if (opts.pid !== undefined) return opts.pid;

  const byPid = await discoverBridgesByPid();
  if (opts.port !== undefined) {
    for (const [pid, cfg] of byPid) {
      if (cfg.port === opts.port) return pid;
    }
    return null;
  }

  const first = await discoverBridge();
  if (first) {
    for (const [pid, cfg] of byPid) {
      if (cfg.port === first.port) return pid;
    }
  }
  // Single unambiguous bridge: use it even if the port match above missed.
  if (byPid.size === 1) return [...byPid.keys()][0]!;
  return null;
}

interface DeepJson {
  pid: number;
  found: boolean;
  source: 'os';
  descendants: number;
  tree: TreeJson | null;
}

interface TreeJson {
  pid: number;
  ppid: number;
  command: string;
  children: TreeJson[];
}

function toJson(n: PsTreeNode): TreeJson {
  return { pid: n.pid, ppid: n.ppid, command: n.command, children: n.children.map(toJson) };
}

async function renderDeep(appPid: number, opts: { json?: boolean }): Promise<void> {
  if (process.platform === 'win32') {
    const msg = 'process-tree --deep is Unix-only (macOS/Linux) in this release.';
    if (opts.json) {
      console.log(JSON.stringify({ pid: appPid, found: false, source: 'os', error: msg }, null, 2));
    } else {
      console.error(`note: ${msg}`);
    }
    return;
  }

  const procs = await snapshotProcesses();
  const tree = buildDescendantTree(procs, appPid);

  if (opts.json) {
    const payload: DeepJson = {
      pid: appPid,
      found: tree !== null,
      source: 'os',
      descendants: tree ? countDescendants(tree) : 0,
      tree: tree ? toJson(tree) : null,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!tree) {
    console.log(`No process found with pid=${appPid} (it may have exited).`);
    return;
  }
  console.log(`app  pid=${tree.pid}  ${shortCommand(tree.command)}`);
  renderChildren(tree.children, '');
  console.log(`\n${countDescendants(tree)} descendant process(es) [source: os]`);
}

function renderChildren(nodes: PsTreeNode[], indent: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const last = i === nodes.length - 1;
    const connector = last ? '└──' : '├──';
    console.log(`${indent}${connector} pid=${node.pid}  ${shortCommand(node.command)}`);
    const childIndent = indent + (last ? '    ' : '│   ');
    renderChildren(node.children, childIndent);
  }
}

/** Trim a full command line to a readable single-line label. */
function shortCommand(command: string): string {
  const trimmed = command.length > 100 ? command.slice(0, 97) + '…' : command;
  return trimmed || '(unknown)';
}

function renderHuman(p: ProcessResponse): void {
  const uptimeSec = Math.floor(p.tauri.uptime_ms / 1000);
  console.log(`tauri  pid=${p.tauri.pid}  uptime=${uptimeSec}s`);
  if (p.tauri.exe) console.log(`       exe=${p.tauri.exe}`);
  if (p.tauri.args.length > 0) console.log(`       args=[${p.tauri.args.join(', ')}]`);
  if (p.sidecars.length === 0) {
    console.log(`└── (no sidecars registered)`);
    console.log(`     Tip: re-run with \`--deep\` to walk the real OS process tree (unregistered children included),`);
    console.log(`     or register sidecars via \`dev_bridge::spawn_sidecar_monitored(.., Some(&registry))\`.`);
    return;
  }
  for (let i = 0; i < p.sidecars.length; i++) {
    const s = p.sidecars[i]!;
    const last = i === p.sidecars.length - 1;
    const connector = last ? '└──' : '├──';
    const alive = s.alive === null || s.alive === undefined ? '?' : s.alive ? 'alive' : 'DEAD';
    console.log(`${connector} ${s.name}  pid=${s.pid}  ${alive}`);
    const indent = last ? '    ' : '│   ';
    if (s.exe) console.log(`${indent}exe=${s.exe}`);
    if (s.args.length > 0) console.log(`${indent}args=[${s.args.join(', ')}]`);
  }
}
