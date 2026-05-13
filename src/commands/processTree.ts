import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import type { ProcessResponse } from '../schemas/bridge.js';

export function registerProcessTree(program: Command): void {
  const cmd = new Command('process-tree')
    .description('Show the Tauri PID and its registered sidecar processes (requires bridge v0.7.0+)')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const proc = await bridge.process();
    if (opts.json) {
      console.log(JSON.stringify(proc, null, 2));
      return;
    }
    renderHuman(proc);
  });

  program.addCommand(cmd);
}

function renderHuman(p: ProcessResponse): void {
  const uptimeSec = Math.floor(p.tauri.uptime_ms / 1000);
  console.log(`tauri  pid=${p.tauri.pid}  uptime=${uptimeSec}s`);
  if (p.tauri.exe) console.log(`       exe=${p.tauri.exe}`);
  if (p.tauri.args.length > 0) console.log(`       args=[${p.tauri.args.join(', ')}]`);
  if (p.sidecars.length === 0) {
    console.log(`└── (no sidecars registered)`);
    console.log(`     Tip: use \`dev_bridge::spawn_sidecar_monitored(name, cmd, args, &buf, Some(&registry))\``);
    console.log(`     or call \`dev_bridge::register_sidecar(&registry, ...)\` after spawning your own.`);
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
