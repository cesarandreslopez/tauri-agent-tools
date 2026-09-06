import { Command } from 'commander';
import type { DisplayServer } from '../types.js';
import { detectDisplayServer } from '../platform/detect.js';
import { BridgeClient } from '../bridge/client.js';
import { addBridgeOptions, resolveBridge, tryResolveBridgeConfig } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { discoverBridgesByPid } from '../bridge/tokenDiscovery.js';
import type { DescribeResponse, VersionResponse } from '../schemas/bridge.js';

interface PageInfo {
  url: string | null;
  title: string | null;
  viewport: { width: number; height: number } | null;
}

interface TargetInfo {
  pid: number | null;
  port: number | null;
  windowLabel: string;
  alive: boolean;
  version: VersionResponse | null;
  describe: DescribeResponse | null;
  page: PageInfo;
  note?: string;
}

interface ProbeResult {
  bridges: Array<{ pid: number; port: number }>;
  target: TargetInfo;
  platform: DisplayServer;
}

export function registerProbe(program: Command): void {
  const cmd = new Command('probe')
    .description('Discover and report Tauri app targets and bridge health')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & { json?: boolean }) => {
    // 1. Discover all bridges by PID
    const bridgesByPid = await discoverBridgesByPid();
    const allBridges = [...bridgesByPid.entries()].map(([pid, cfg]) => ({
      pid,
      port: cfg.port,
    }));

    // 2. Detect platform early so the no-bridge path can still emit a full result.
    const platform = detectDisplayServer();

    const hasExplicitTarget =
      opts.port !== undefined || opts.token !== undefined || opts.pid !== undefined;

    // 3. Resolve specific bridge (may throw if none found)
    let bridge: BridgeClient;
    if (!hasExplicitTarget && allBridges.length === 0) {
      const config = await tryResolveBridgeConfig(opts);
      if (config === null) {
        const note =
          'Start the Tauri dev app with the dev bridge enabled, or pass --port and --token.';
        const result: ProbeResult = {
          bridges: allBridges,
          target: {
            pid: null, port: null, windowLabel: opts.windowLabel ?? 'main',
            alive: false,
            version: null,
            describe: null,
            page: { url: null, title: null, viewport: null },
            note,
          },
          platform,
        };

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log('=== Tauri Bridge Probe ===');
        console.log('');
        console.log('Running bridges:  none');
        console.log('');
        console.log(`Platform:         ${platform}`);
        console.log('Bridge alive:     no');
        console.log(`Note:             ${note}`);
        console.log('');
        console.log('Page:');
        console.log('  URL:      (unavailable)');
        console.log('  Title:    (unavailable)');
        console.log('  Viewport: (unavailable)');
        return;
      }
      bridge = new BridgeClient(config, opts.windowLabel);
    } else {
      bridge = await resolveBridge(opts);
    }

    // 4. Ping
    const alive = await bridge.ping();

    // 5. Get version (graceful null on 404)
    const versionInfo = await bridge.version();

    // 6. Get describe (graceful null on 404)
    const describeInfo = await bridge.describe();

    // 7. Get page info via eval (try/catch each independently)
    let url: string | null = null;
    let title: string | null = null;
    let viewport: { width: number; height: number } | null = null;

    try {
      if (alive) url = String(await bridge.eval('window.location.href'));
    } catch {
      // bridge may be unreachable or page not loaded
    }

    try {
      if (alive) title = String(await bridge.eval('document.title'));
    } catch {
      // ignore
    }

    try {
      if (alive) viewport = await bridge.getViewportSize();
    } catch {
      // ignore
    }

    const targetPort = bridge.port;
    const targetPid = describeInfo?.pid ?? allBridges.find(b => b.port === targetPort)?.pid ?? null;
    const ambiguity = !hasExplicitTarget && allBridges.length > 1
      ? `Auto-selected PID ${targetPid ?? '?'} on port ${targetPort}. Use --pid <n> to select among ${allBridges.length} bridges.`
      : undefined;
    if (ambiguity) console.error(`note: ${ambiguity}`);

    const result: ProbeResult = {
      bridges: allBridges,
      target: {
        pid: targetPid, port: targetPort, windowLabel: opts.windowLabel ?? 'main',
        ...(ambiguity ? { note: ambiguity } : {}),
        alive,
        version: versionInfo,
        describe: describeInfo,
        page: { url, title, viewport },
      },
      platform,
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Human-readable output
    console.log('=== Tauri Bridge Probe ===');
    console.log('');

    if (allBridges.length === 0) {
      console.log('Running bridges:  none');
    } else {
      console.log(`Running bridges:  ${allBridges.length}`);
      for (const b of allBridges) {
        console.log(`  PID ${b.pid}  port ${b.port}`);
      }
    }

    console.log('');
    console.log(`Platform:         ${platform}`);
    console.log(`Bridge alive:     ${alive ? 'yes' : 'no'}`);
    console.log(`Selected target:  PID ${targetPid ?? '?'}  port ${targetPort}  window ${opts.windowLabel ?? 'main'}`);

    if (versionInfo) {
      console.log(`Bridge version:   ${versionInfo.version}`);
      console.log(`Endpoints:        ${versionInfo.endpoints.join(', ')}`);
    }

    if (describeInfo) {
      if (describeInfo.app !== undefined) console.log(`App:              ${describeInfo.app}`);
      if (describeInfo.pid !== undefined) console.log(`App PID:          ${describeInfo.pid}`);
      if (describeInfo.windows !== undefined)
        console.log(`Windows:          ${describeInfo.windows.join(', ')}`);
      if (describeInfo.capabilities !== undefined)
        console.log(`Capabilities:     ${describeInfo.capabilities.join(', ')}`);
    }

    console.log('');
    console.log('Page:');
    console.log(`  URL:      ${url ?? '(unavailable)'}`);
    console.log(`  Title:    ${title ?? '(unavailable)'}`);
    if (viewport) {
      console.log(`  Viewport: ${viewport.width}x${viewport.height}`);
    } else {
      console.log('  Viewport: (unavailable)');
    }
  });

  program.addCommand(cmd);
}
