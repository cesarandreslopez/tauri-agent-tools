import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCapability, resolveTauriProject } from '../util/tauriConfig.js';
import type { Capability, CapabilityPermission } from '../schemas/tauriConfig.js';

interface ConfigInspectOpts {
  config?: string;
  capabilitiesDir?: string;
  cargoToml?: string;
  json?: boolean;
}

interface CapabilitySummary {
  file: string;
  identifier: string;
  description: string | null;
  windows: string[];
  platforms: string[];
  permissions: PermissionEntry[];
  permissionCount: number;
}

interface PermissionEntry {
  identifier: string;
  hasAllow: boolean;
  hasDeny: boolean;
}

interface Warning {
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, string>;
}

interface ConfigInspectOutput {
  identifier: string;
  productName: string;
  version: string | null;
  mainBinaryName: string | null;
  devUrl: string | null;
  devPort: number | null;
  frontendDist: string | null;
  sidecars: string[];
  windows: string[];
  configPath: string;
  capabilities: CapabilitySummary[];
  declaredPlugins: string[];
  warnings: Warning[];
}

const OVERBROAD_PERMISSIONS = new Set([
  'fs:allow-all',
  'fs:default',
  'shell:allow-execute',
  'shell:allow-spawn',
  'http:allow-all',
]);

export function registerConfigInspect(program: Command): void {
  const cmd = new Command('config')
    .description('Inspect a Tauri app config (paths, capabilities, sidecars)');
  cmd
    .command('inspect')
    .description('Emit a structured snapshot of tauri.conf.json + capabilities')
    .option('--config <path>', 'Path to tauri.conf.json (or its directory). Auto-detected if omitted.')
    .option(
      '--capabilities-dir <path>',
      'Directory holding capability *.json files (default: <project>/src-tauri/capabilities/)',
    )
    .option(
      '--cargo-toml <path>',
      'Path to the Rust crate\'s Cargo.toml (default: <project>/src-tauri/Cargo.toml). Used to cross-check plugin declarations.',
    )
    .option('--json', 'Output as JSON')
    .action(async (opts: ConfigInspectOpts) => {
      const resolved = await resolveTauriProject({
        configPath: opts.config,
        capabilitiesDir: opts.capabilitiesDir,
      });

      const capabilities = await loadAllCapabilities(resolved.capabilityFiles);
      const cargoTomlPath = opts.cargoToml ?? defaultCargoToml(resolved.configPath);
      const cargoTomlExists = existsSync(cargoTomlPath);
      const declaredPlugins = cargoTomlExists ? await readDeclaredPlugins(cargoTomlPath) : [];
      const warnings = collectWarnings(
        capabilities,
        declaredPlugins,
        resolved.sidecars,
        cargoTomlExists,
      );

      const out: ConfigInspectOutput = {
        identifier: resolved.identifier,
        productName: resolved.productName,
        version: resolved.version,
        mainBinaryName: resolved.mainBinaryName,
        devUrl: resolved.devUrl,
        devPort: resolved.devPort,
        frontendDist: resolved.frontendDist,
        sidecars: resolved.sidecars,
        windows: resolved.windows,
        configPath: resolved.configPath,
        capabilities,
        declaredPlugins,
        warnings,
      };

      if (opts.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        printHumanReadable(out);
      }
    });

  program.addCommand(cmd);
}

async function loadAllCapabilities(files: string[]): Promise<CapabilitySummary[]> {
  const out: CapabilitySummary[] = [];
  for (const file of files) {
    let cap: Capability;
    try {
      cap = await loadCapability(file);
    } catch (err) {
      // Surface as a degenerate entry rather than aborting — the warning collector
      // wants to know about malformed capability files too.
      out.push({
        file,
        identifier: '<parse-error>',
        description: err instanceof Error ? err.message : String(err),
        windows: [],
        platforms: [],
        permissions: [],
        permissionCount: 0,
      });
      continue;
    }
    const perms = cap.permissions.map(permissionToEntry);
    out.push({
      file,
      identifier: cap.identifier,
      description: cap.description ?? null,
      windows: cap.windows ?? [],
      platforms: cap.platforms ?? [],
      permissions: perms,
      permissionCount: perms.length,
    });
  }
  return out;
}

function permissionToEntry(p: CapabilityPermission): PermissionEntry {
  if (typeof p === 'string') {
    return { identifier: p, hasAllow: false, hasDeny: false };
  }
  return {
    identifier: p.identifier,
    hasAllow: Array.isArray(p.allow) && p.allow.length > 0,
    hasDeny: Array.isArray(p.deny) && p.deny.length > 0,
  };
}

function defaultCargoToml(configPath: string): string {
  // configPath is .../src-tauri/tauri.conf.json → Cargo.toml lives alongside.
  return join(configPath, '..', 'Cargo.toml');
}

async function readDeclaredPlugins(cargoToml: string): Promise<string[]> {
  const text = await readFile(cargoToml, 'utf-8');
  // Match `tauri-plugin-<name>` package names in dependencies. Conservative regex —
  // doesn't try to parse TOML; just grabs the plugin family that matters for the
  // capability/plugin cross-check.
  const matches = text.matchAll(/\b(tauri-plugin-[a-z0-9_-]+)\b/g);
  const plugins = new Set<string>();
  for (const m of matches) {
    const name = m[1];
    if (name) plugins.add(name);
  }
  return Array.from(plugins).sort();
}

function collectWarnings(
  capabilities: CapabilitySummary[],
  declaredPlugins: string[],
  sidecars: string[],
  cargoTomlPresent: boolean,
): Warning[] {
  const out: Warning[] = [];

  for (const cap of capabilities) {
    if (cap.identifier === '<parse-error>') {
      out.push({
        level: 'error',
        message: `Capability file failed to parse: ${cap.file}`,
        context: { error: cap.description ?? '' },
      });
      continue;
    }

    if (cap.permissions.length === 0) {
      out.push({
        level: 'info',
        message: `Capability "${cap.identifier}" has no permissions declared`,
        context: { file: cap.file },
      });
    }

    for (const perm of cap.permissions) {
      if (perm.identifier === '*') {
        out.push({
          level: 'error',
          message: `Capability "${cap.identifier}" grants wildcard permission "*"`,
          context: { file: cap.file },
        });
        continue;
      }
      if (OVERBROAD_PERMISSIONS.has(perm.identifier)) {
        out.push({
          level: 'warn',
          message: `Capability "${cap.identifier}" uses over-broad permission "${perm.identifier}"`,
          context: { file: cap.file },
        });
      }

      // Cross-check: if the permission references a plugin family, that plugin
      // should also be declared in Cargo.toml. (Built-in `core:*` permissions are
      // exempt — they don't map to a tauri-plugin-* crate.) Skip the check entirely
      // when Cargo.toml is missing — we have no ground truth, so reporting would
      // be a false positive.
      const [family] = perm.identifier.split(':');
      if (family && family !== 'core' && cargoTomlPresent) {
        const expectedCrate = `tauri-plugin-${family}`;
        if (!declaredPlugins.includes(expectedCrate)) {
          out.push({
            level: 'warn',
            message: `Capability "${cap.identifier}" references plugin "${family}" but ${expectedCrate} is not in Cargo.toml`,
            context: { file: cap.file },
          });
        }
      }
    }
  }

  // Sidecars declared in bundle.externalBin but no shell plugin → unusable.
  if (sidecars.length > 0 && cargoTomlPresent && !declaredPlugins.includes('tauri-plugin-shell')) {
    out.push({
      level: 'warn',
      message: `bundle.externalBin declares ${sidecars.length} sidecar(s) but tauri-plugin-shell is not in Cargo.toml — sidecars are launched through the shell plugin`,
    });
  }

  return out;
}

function printHumanReadable(out: ConfigInspectOutput): void {
  console.log(`Identifier:    ${out.identifier}`);
  console.log(`Product name:  ${out.productName}`);
  if (out.version) console.log(`Version:       ${out.version}`);
  if (out.devUrl) console.log(`Dev URL:       ${out.devUrl} (port ${out.devPort ?? 'unknown'})`);
  if (out.frontendDist) console.log(`Frontend dist: ${out.frontendDist}`);
  if (out.sidecars.length > 0) {
    console.log(`\nSidecars (${out.sidecars.length}):`);
    for (const s of out.sidecars) console.log(`  • ${s}`);
  }
  if (out.windows.length > 0) {
    console.log(`\nWindows (${out.windows.length}):`);
    for (const w of out.windows) console.log(`  • ${w}`);
  }
  if (out.declaredPlugins.length > 0) {
    console.log(`\nDeclared plugins (${out.declaredPlugins.length}):`);
    for (const p of out.declaredPlugins) console.log(`  • ${p}`);
  }
  console.log(`\nCapabilities (${out.capabilities.length}):`);
  for (const cap of out.capabilities) {
    console.log(`  [${cap.identifier}] ${cap.permissionCount} permission(s)`);
    if (cap.description) console.log(`     ${cap.description}`);
    if (cap.windows.length > 0) console.log(`     windows: ${cap.windows.join(', ')}`);
  }
  if (out.warnings.length > 0) {
    console.log(`\nWarnings (${out.warnings.length}):`);
    for (const w of out.warnings) {
      const tag = w.level.toUpperCase().padEnd(5);
      console.log(`  ${tag} ${w.message}`);
    }
  } else {
    console.log(`\nNo warnings.`);
  }
}
