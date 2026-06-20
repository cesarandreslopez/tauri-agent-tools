import { Command } from 'commander';
import {
  addBridgeOptions,
  resolveBridge,
  endpointAvailable,
  endpointUnavailableNote,
} from './shared.js';
import type { BridgeOpts } from './shared.js';
import type { CapabilitiesResponse, LiveCapabilityEntry } from '../schemas/bridge.js';

interface AuditFinding {
  level: 'info' | 'warn' | 'error';
  capability: string;
  message: string;
}

interface AuditOutput {
  windows: string[];
  capabilities: LiveCapabilityEntry[];
  findings: AuditFinding[];
}

const OVERBROAD_PERMISSIONS = new Set([
  'fs:allow-all',
  'fs:default',
  'shell:allow-execute',
  'shell:allow-spawn',
  'http:allow-all',
]);

export function registerCapabilitiesAudit(program: Command): void {
  const cmd = new Command('capabilities')
    .description('Audit Tauri capabilities live from a running app (requires bridge v0.7.0+)');
  const sub = cmd
    .command('audit')
    .description('Fetch the live capability set from the bridge and flag risky permissions')
    .option('--json', 'Output as JSON');

  addBridgeOptions(sub);

  sub.action(async (opts: BridgeOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);

    // Graceful degradation: older bridges (pre-v0.7) have no /capabilities
    // endpoint. Point the user at the bridge-free static auditor instead.
    if (!(await endpointAvailable(bridge, '/capabilities', opts))) {
      const note =
        endpointUnavailableNote('/capabilities', (await bridge.version())?.version) +
        ' For a bridge-free audit, run `tauri-agent-tools config inspect`.';
      if (opts.json) {
        console.log(JSON.stringify({ endpoint: '/capabilities', available: false, note }, null, 2));
      } else {
        console.error(`note: ${note}`);
      }
      return;
    }

    const caps = await bridge.capabilities();
    const findings = audit(caps);
    const out: AuditOutput = {
      windows: caps.windows,
      capabilities: caps.declared,
      findings,
    };
    if (opts.json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    renderHuman(out);
  });

  program.addCommand(cmd);
}

function audit(caps: CapabilitiesResponse): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const cap of caps.declared) {
    if (cap.permissions.length === 0) {
      // Capability declared by JSON-file reference is reported as a bare
      // identifier with no permissions array — the bridge can't read the file.
      // Surface it as info so the user knows we don't have details.
      findings.push({
        level: 'info',
        capability: cap.identifier,
        message: 'Permissions list is empty (capability may be declared by file reference; use `config inspect` for static analysis)',
      });
      continue;
    }

    for (const perm of cap.permissions) {
      if (perm === '*') {
        findings.push({
          level: 'error',
          capability: cap.identifier,
          message: 'Grants wildcard permission "*"',
        });
        continue;
      }
      if (OVERBROAD_PERMISSIONS.has(perm)) {
        findings.push({
          level: 'warn',
          capability: cap.identifier,
          message: `Uses over-broad permission "${perm}"`,
        });
      }
    }

    if (cap.windows.length === 0) {
      findings.push({
        level: 'info',
        capability: cap.identifier,
        message: 'No window scope declared — capability applies to all windows',
      });
    } else {
      const unknown = cap.windows.filter(
        (w) => !caps.windows.includes(w) && !w.includes('*') && !w.includes('?'),
      );
      if (unknown.length > 0) {
        findings.push({
          level: 'warn',
          capability: cap.identifier,
          message: `References window label(s) not registered with this app: ${unknown.join(', ')}`,
        });
      }
    }
  }

  return findings;
}

function renderHuman(out: AuditOutput): void {
  console.log(`Live windows (${out.windows.length}): ${out.windows.join(', ') || '(none)'}`);
  console.log(`Capabilities (${out.capabilities.length}):`);
  for (const cap of out.capabilities) {
    const winScope = cap.windows.length === 0 ? 'all windows' : cap.windows.join(', ');
    console.log(`  [${cap.identifier}] ${cap.permissions.length} permission(s), scope: ${winScope}`);
    if (cap.description) console.log(`     ${cap.description}`);
  }
  if (out.findings.length === 0) {
    console.log('\nNo findings.');
    return;
  }
  console.log(`\nFindings (${out.findings.length}):`);
  for (const f of out.findings) {
    const tag = f.level.toUpperCase().padEnd(5);
    console.log(`  ${tag} [${f.capability}] ${f.message}`);
  }
}
