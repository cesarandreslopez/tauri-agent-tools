import { Command } from 'commander';
import type { DisplayServer } from '../types.js';
import { detectDisplayServer } from '../platform/detect.js';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { discoverBridgesByPid, discoverBridge } from '../bridge/tokenDiscovery.js';
import type { DescribeResponse, VersionResponse } from '../schemas/bridge.js';

interface PageInfo {
  url: string | null;
  title: string | null;
  viewport: { width: number; height: number } | null;
}

interface TargetInfo {
  alive: boolean;
  version: VersionResponse | null;
  describe: DescribeResponse | null;
  page: PageInfo;
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

    // 2. Resolve specific bridge (may throw if none found)
    const bridge = await resolveBridge(opts);

    // 3. Ping
    const alive = await bridge.ping();

    // 4. Get version (graceful null on 404)
    const versionInfo = await bridge.version();

    // 5. Get describe (graceful null on 404)
    const describeInfo = await bridge.describe();

    // 6. Get page info via eval (try/catch each independently)
    let url: string | null = null;
    let title: string | null = null;
    let viewport: { width: number; height: number } | null = null;

    try {
      url = String(await bridge.eval('window.location.href'));
    } catch {
      // bridge may be unreachable or page not loaded
    }

    try {
      title = String(await bridge.eval('document.title'));
    } catch {
      // ignore
    }

    try {
      viewport = await bridge.getViewportSize();
    } catch {
      // ignore
    }

    // 7. Detect platform
    const platform = detectDisplayServer();

    // Determine the port for the target by checking opts or discovered bridge
    let targetPort = opts.port;
    if (targetPort === undefined) {
      if (opts.pid !== undefined) {
        const pidEntry = bridgesByPid.get(opts.pid);
        targetPort = pidEntry?.port;
      }
      if (targetPort === undefined) {
        const first = await discoverBridge();
        targetPort = first?.port;
      }
    }

    const result: ProbeResult = {
      bridges: allBridges,
      target: {
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
