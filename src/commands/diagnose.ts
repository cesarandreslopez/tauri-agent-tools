import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { addBridgeOptions, type BridgeOpts } from './shared.js';
import { BridgeClient } from '../bridge/client.js';
import { discoverBridge, discoverBridgesByPid } from '../bridge/tokenDiscovery.js';
import type {
  CapabilitiesResponse,
  DevtoolsResponse,
  HealthResponse,
  ProcessResponse,
} from '../schemas/bridge.js';
import { resolveTauriProject } from '../util/tauriConfig.js';

interface DiagnoseOpts extends BridgeOpts {
  config?: string;
  identifier?: string;
  out?: string;
  since?: string;
  logsDuration?: string;
  json?: boolean;
  /** Skip the bridge-enrichment phase even if a bridge is reachable. */
  noBridge?: boolean;
}

interface PhaseOutcome {
  phase: string;
  ok: boolean;
  detail: string;
}

interface BridgeData {
  reachable: boolean;
  version: string | null;
  process: ProcessResponse | null;
  capabilities: CapabilitiesResponse | null;
  devtools: DevtoolsResponse | null;
  health: HealthResponse | null;
  errors: Record<string, string>;
}

export function registerDiagnose(program: Command): void {
  const cmd = new Command('diagnose')
    .description(
      "Full diagnostic bundle: composes `forensics` with live bridge data when available. Best-effort — degrades cleanly when the bridge isn't reachable.",
    )
    .option('--config <path>', 'Path to tauri.conf.json (or its directory). Auto-detected if omitted.')
    .option('--identifier <id>', 'Bundle identifier override')
    .option('-o, --out <dir>', 'Output directory (default: ./diagnose-<timestamp>)')
    .option('--since <duration>', 'How far back to pull from app log files (forensics phase, default: 10m)')
    .option(
      '--logs-duration <ms>',
      'Time budget for live OS-log tail in milliseconds (default: 3000)',
    )
    .option('--no-bridge', 'Skip bridge-enrichment phase even if a bridge is reachable')
    .option('--json', 'Print the master summary as JSON in addition to writing to disk');

  addBridgeOptions(cmd);

  cmd.action(async (opts: DiagnoseOpts) => {
    const outDir = opts.out ?? `./diagnose-${timestampSlug()}`;
    await mkdir(outDir, { recursive: true });
    const forensicsDir = join(outDir, 'forensics');
    await mkdir(forensicsDir, { recursive: true });

    const outcomes: PhaseOutcome[] = [];

    // ── Phase A: Resolve project (for the summary header) ──────────────────
    let identifier = '<unknown>';
    let productName = '<unknown>';
    try {
      const resolved = await resolveTauriProject({
        configPath: opts.config,
        identifierOverride: opts.identifier,
      });
      identifier = resolved.identifier;
      productName = resolved.productName;
      outcomes.push({
        phase: 'resolve-config',
        ok: true,
        detail: `identifier=${identifier} productName=${productName}`,
      });
    } catch (err) {
      outcomes.push({
        phase: 'resolve-config',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Phase B: Forensics subprocess (Tier 1 bundle) ──────────────────────
    const forensicsArgs = ['forensics', '-o', forensicsDir, '--logs-duration', String(opts.logsDuration ?? 3000)];
    if (opts.config) forensicsArgs.push('--config', opts.config);
    if (opts.identifier) forensicsArgs.push('--identifier', opts.identifier);
    if (opts.since) forensicsArgs.push('--since', opts.since);

    try {
      await runSelf(forensicsArgs);
      outcomes.push({ phase: 'forensics', ok: true, detail: `→ ${forensicsDir}` });
    } catch (err) {
      outcomes.push({
        phase: 'forensics',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Phase C: Bridge enrichment (Tier 2) — optional, best-effort ────────
    const bridgeData = await collectBridgeData(opts, outcomes);
    await writeFile(join(outDir, 'bridge.json'), JSON.stringify(bridgeData, null, 2));

    // ── Phase D: Master summary ────────────────────────────────────────────
    const forensicsSummary = await tryReadJson<Record<string, unknown>>(
      join(forensicsDir, 'summary.json'),
    );

    const master = {
      identifier,
      productName,
      outDir,
      forensicsDir,
      phases: outcomes,
      bridgeReachable: bridgeData.reachable,
      bridgeVersion: bridgeData.version,
      forensicsSummary: forensicsSummary ?? null,
    };

    await writeFile(join(outDir, 'summary.json'), JSON.stringify(master, null, 2));
    await writeFile(join(outDir, 'summary.md'), renderMaster(master, bridgeData, outcomes));

    if (opts.json) {
      console.log(JSON.stringify(master, null, 2));
    } else {
      const ok = outcomes.filter((o) => o.ok).length;
      console.log(`✓ Diagnostic bundle written to ${outDir}`);
      console.log(`  ${ok}/${outcomes.length} phases succeeded`);
      console.log(`  Bridge: ${bridgeData.reachable ? `reachable (v${bridgeData.version})` : 'unreachable — bundle is forensics-only'}`);
    }
  });

  program.addCommand(cmd);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Spawn the same CLI binary that's currently running, for one-level composition. */
function runSelf(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cliPath = process.argv[1];
    if (!cliPath) {
      reject(new Error('Could not locate the current CLI binary (process.argv[1] is empty)'));
      return;
    }
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`subprocess exited ${code}${stderr ? ': ' + stderr.trim() : ''}`));
    });
  });
}

async function tryReadJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function collectBridgeData(opts: DiagnoseOpts, outcomes: PhaseOutcome[]): Promise<BridgeData> {
  const data: BridgeData = {
    reachable: false,
    version: null,
    process: null,
    capabilities: null,
    devtools: null,
    health: null,
    errors: {},
  };

  if (opts.noBridge) {
    outcomes.push({ phase: 'bridge', ok: true, detail: 'skipped (--no-bridge)' });
    return data;
  }

  // Resolve a bridge config without throwing — diagnose tolerates absence.
  const cfg = await tryResolveBridgeConfig(opts);
  if (!cfg) {
    outcomes.push({ phase: 'bridge', ok: false, detail: 'no live bridge discovered' });
    return data;
  }

  const client = new BridgeClient(cfg, opts.windowLabel);
  const version = await client.version();
  if (!version) {
    outcomes.push({ phase: 'bridge', ok: false, detail: `bridge at port ${cfg.port} did not respond to /version` });
    return data;
  }

  data.reachable = true;
  data.version = version.version;

  // Each endpoint is best-effort; record per-endpoint failures rather than aborting.
  for (const [name, fn] of [
    ['process', () => client.process()] as const,
    ['capabilities', () => client.capabilities()] as const,
    ['devtools', () => client.devtools()] as const,
    ['health', () => client.health()] as const,
  ]) {
    try {
      const result = await fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any)[name] = result;
      outcomes.push({ phase: `bridge:${name}`, ok: true, detail: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      data.errors[name] = msg;
      outcomes.push({ phase: `bridge:${name}`, ok: false, detail: msg });
    }
  }

  return data;
}

async function tryResolveBridgeConfig(
  opts: BridgeOpts,
): Promise<{ port: number; token: string } | null> {
  try {
    if (opts.port && opts.token) {
      return { port: opts.port, token: opts.token };
    }
    if (opts.pid !== undefined) {
      const bridges = await discoverBridgesByPid();
      const match = bridges.get(opts.pid);
      if (!match) return null;
      return {
        port: opts.port ?? match.port,
        token: opts.token ?? match.token,
      };
    }
    const discovered = await discoverBridge();
    if (!discovered) return null;
    return {
      port: opts.port ?? discovered.port,
      token: opts.token ?? discovered.token,
    };
  } catch {
    return null;
  }
}

function renderMaster(
  master: { identifier: string; productName: string; outDir: string; forensicsDir: string },
  bridge: BridgeData,
  outcomes: PhaseOutcome[],
): string {
  const phaseRows = outcomes
    .map((o) => `- ${o.ok ? '✓' : '✗'} **${o.phase}** — ${o.detail}`)
    .join('\n');

  const bridgeSection = bridge.reachable ? renderBridgeSection(bridge) : NO_BRIDGE_HINT;

  return `# Diagnose: ${master.productName}

- **Identifier:** \`${master.identifier}\`
- **Output:** \`${master.outDir}\`
- **Forensics bundle:** [\`${master.forensicsDir}/summary.md\`](./forensics/summary.md)

## Phases

${phaseRows}

## Bridge enrichment

${bridgeSection}

## Next steps

${suggestNext(master, bridge, outcomes)}
`;
}

const NO_BRIDGE_HINT = `_No live dev bridge was reachable._ The bundle in \`forensics/\` is still useful for post-mortem analysis (OS log tail, panic markers, app data file listing). To get richer data next time:

- Confirm the app is running in dev mode (\`cfg!(debug_assertions)\` must be true)
- Check for token files: \`ls /tmp/tauri-dev-bridge-*.token\`
- If you have a PID, pass \`--pid <n>\` explicitly
`;

function renderBridgeSection(bridge: BridgeData): string {
  const parts: string[] = [`_Bridge v${bridge.version} responded._`, ''];

  if (bridge.health) {
    parts.push('### Health');
    parts.push('');
    parts.push(`- Uptime: ${Math.floor(bridge.health.uptime_ms / 1000)}s`);
    parts.push(`- Webview ready: ${bridge.health.webview_ready ? 'yes' : '**NO**'}`);
    parts.push(`- Sidecars alive: ${bridge.health.sidecars_alive ? 'yes' : '**NO**'}`);
    parts.push('');
  }

  if (bridge.process) {
    parts.push('### Process tree');
    parts.push('');
    parts.push(`- Tauri pid \`${bridge.process.tauri.pid}\` (uptime ${Math.floor(bridge.process.tauri.uptime_ms / 1000)}s)`);
    if (bridge.process.sidecars.length === 0) {
      parts.push('- No sidecars registered');
    } else {
      for (const s of bridge.process.sidecars) {
        const alive = s.alive === null || s.alive === undefined ? '?' : s.alive ? 'alive' : '**DEAD**';
        parts.push(`- Sidecar \`${s.name}\` pid \`${s.pid}\` — ${alive}`);
      }
    }
    parts.push('');
  }

  if (bridge.devtools) {
    parts.push('### Webview devtools');
    parts.push('');
    parts.push(`- Platform: ${bridge.devtools.platform}`);
    parts.push(`- Inspectable: ${bridge.devtools.inspectable ? 'yes' : 'no'}`);
    if (bridge.devtools.url) parts.push(`- URL: ${bridge.devtools.url}`);
    parts.push(`- Hint: ${bridge.devtools.hint}`);
    parts.push('');
  }

  if (bridge.capabilities) {
    parts.push('### Capabilities');
    parts.push('');
    parts.push(`- Windows: ${bridge.capabilities.windows.join(', ') || '(none)'}`);
    parts.push(`- Declared: ${bridge.capabilities.declared.length}`);
    parts.push('');
  }

  if (Object.keys(bridge.errors).length > 0) {
    parts.push('### Bridge endpoint errors');
    parts.push('');
    for (const [endpoint, err] of Object.entries(bridge.errors)) {
      parts.push(`- \`${endpoint}\`: ${err}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

function suggestNext(
  master: { identifier: string },
  bridge: BridgeData,
  outcomes: PhaseOutcome[],
): string {
  const tips: string[] = [];

  if (!bridge.reachable) {
    tips.push(
      `- Bridge was not reachable; the bundle in \`forensics/\` is your best evidence. Inspect \`forensics/summary.md\` first.`,
    );
  }
  if (bridge.health && !bridge.health.webview_ready) {
    tips.push(
      `- The bridge reports the webview is **not ready**. Likely a pre-webview-boot failure — check \`forensics/app-log-tail.txt\` for the last Rust messages before the webview was supposed to come up.`,
    );
  }
  if (bridge.health && !bridge.health.sidecars_alive) {
    tips.push(
      `- One or more sidecars are dead. Run \`tauri-agent-tools sidecar tap --schema <path> -- <cmd>\` against the failing sidecar to see exactly what envelope it emits before exiting.`,
    );
  }
  if (outcomes.some((o) => o.phase === 'forensics' && !o.ok)) {
    tips.push(
      `- The forensics subprocess failed. Run \`tauri-agent-tools forensics --config ${master.identifier === '<unknown>' ? '<path>' : 'auto'} -o /tmp/forensics\` directly to surface the error.`,
    );
  }
  if (tips.length === 0) {
    tips.push(
      `- No specific anomalies detected. Browse \`${'forensics/summary.md'}\` and the per-endpoint JSON in \`bridge.json\` for context.`,
    );
  }
  return tips.join('\n');
}
