import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import type { HealthResponse } from '../schemas/bridge.js';

export function registerHealth(program: Command): void {
  const cmd = new Command('health')
    .description('Quick "is this Tauri app sick" check (requires bridge v0.7.0+)')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const h = await bridge.health();
    if (opts.json) {
      console.log(JSON.stringify(h, null, 2));
      // Exit non-zero on detected issues so this can drive CI gates.
      if (!h.webview_ready || !h.sidecars_alive) process.exitCode = 1;
      return;
    }
    renderHuman(h);
    if (!h.webview_ready || !h.sidecars_alive) process.exitCode = 1;
  });

  program.addCommand(cmd);
}

function renderHuman(h: HealthResponse): void {
  const uptimeSec = Math.floor(h.uptime_ms / 1000);
  console.log(`Uptime:         ${uptimeSec}s`);
  console.log(`Webview ready:  ${h.webview_ready ? 'yes' : 'NO'}`);
  console.log(`Sidecars alive: ${h.sidecars_alive ? 'yes' : 'NO'}`);
  if (h.sidecars.length === 0) {
    console.log(`Sidecars:       (none registered)`);
    return;
  }
  console.log(`Sidecars (${h.sidecars.length}):`);
  for (const s of h.sidecars) {
    const alive = s.alive === null || s.alive === undefined ? '?' : s.alive ? 'alive' : 'DEAD';
    console.log(`  ${s.name.padEnd(20)} pid=${s.pid} ${alive}`);
  }
}
