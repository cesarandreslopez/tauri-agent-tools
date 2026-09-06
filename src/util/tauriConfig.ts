import JSON5 from 'json5';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  CapabilitySchema,
  type Capability,
  type ResolvedTauriConfig,
  type TauriConfig,
  TauriConfigSchema,
  type TauriPathSet,
} from '../schemas/tauriConfig.js';

const TAURI_CONFIG_FILENAMES = ['tauri.conf.json', 'tauri.conf.json5', 'Tauri.toml'];

export interface ConfigLoadOptions {
  /** Explicit path to tauri.conf.json. If a directory, searches for the config file inside. */
  configPath?: string;
  /** Search ceiling for upward traversal (default: filesystem root). */
  startDir?: string;
}

export interface LoadedTauriConfig {
  configPath: string;
  projectDir: string;
  raw: TauriConfig;
}

/**
 * Walk up from `startDir` looking for a Tauri config file. Returns the absolute
 * path of the first match, or null if none is found before the filesystem root.
 */
export function findTauriConfig(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  while (true) {
    for (const name of TAURI_CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
      // Also look inside src-tauri/ — Tauri 2 scaffold layout
      const inSrcTauri = join(dir, 'src-tauri', name);
      if (existsSync(inSrcTauri)) return inSrcTauri;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadTauriConfig(opts: ConfigLoadOptions = {}): Promise<LoadedTauriConfig> {
  let configPath: string | null;
  if (opts.configPath) {
    const explicit = resolve(opts.configPath);
    const st = await stat(explicit).catch(() => null);
    if (st?.isDirectory()) {
      const found = findTauriConfig(explicit);
      if (!found) throw new Error(`No tauri.conf.json found under ${explicit}`);
      configPath = found;
    } else {
      configPath = explicit;
    }
  } else {
    configPath = findTauriConfig(opts.startDir);
  }

  if (!configPath) {
    throw new Error(
      'No tauri.conf.json found. Specify --config <path> or run inside a Tauri project.',
    );
  }

  if (configPath.endsWith('.toml')) {
    throw new Error(
      `Tauri.toml configs are not yet supported (found ${configPath}). Use tauri.conf.json or pass --identifier explicitly.`,
    );
  }

  const text = await readFile(configPath, 'utf-8');
  let parsed: unknown;
  try { parsed = JSON5.parse(text); }
  catch (error) { throw new Error(`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`); }
  const raw = TauriConfigSchema.parse(parsed);

  return {
    configPath,
    projectDir: dirname(configPath),
    raw,
  };
}

/**
 * Resolve the bundle identifier from a Tauri config (handling v1 + v2 layouts).
 */
export function resolveIdentifier(raw: TauriConfig): string {
  if (raw.identifier && raw.identifier.length > 0) return raw.identifier;
  if (raw.bundle?.identifier && raw.bundle.identifier.length > 0) return raw.bundle.identifier;
  const v1 = raw.tauri as { bundle?: { identifier?: string } } | undefined;
  if (v1?.bundle?.identifier) return v1.bundle.identifier;
  throw new Error(
    'tauri.conf.json is missing a bundle identifier (top-level "identifier" or "bundle.identifier").',
  );
}

export function resolveProductName(raw: TauriConfig, fallback: string): string {
  if (raw.productName && raw.productName.length > 0) return raw.productName;
  const v1 = raw.tauri as { productName?: string } | undefined;
  if (v1?.productName) return v1.productName;
  return fallback;
}

/**
 * Compute the dev server port from build.devUrl or build.devPath. Returns null
 * if neither is a parseable URL with a port.
 */
export function resolveDevPort(raw: TauriConfig): number | null {
  const candidate = raw.build?.devUrl ?? raw.build?.devPath;
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.port) return parseInt(parsed.port, 10);
    if (parsed.protocol === 'https:') return 443;
    if (parsed.protocol === 'http:') return 80;
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve Tauri 2's app_* directories for every supported platform. The semantics
 * follow Tauri's PathResolver:
 *   - macOS:  data/local/config all → ~/Library/Application Support/<id>;
 *             cache → ~/Library/Caches/<id>; log → ~/Library/Logs/<id>
 *   - Linux:  data/local-data → $XDG_DATA_HOME/<id>; cache → $XDG_CACHE_HOME/<id>;
 *             config → $XDG_CONFIG_HOME/<id>; log → $XDG_DATA_HOME/<id>/logs
 *   - Win32:  data/config → %APPDATA%\<id> (Roaming);
 *             local-data/cache → %LOCALAPPDATA%\<id>; log → %LOCALAPPDATA%\<id>\logs
 *
 * Uses the *current* process's env where appropriate (HOME/XDG_* on Linux/macOS,
 * APPDATA/LOCALAPPDATA on Windows). Cross-platform paths still resolve to plausible
 * defaults on the host platform so callers can inspect another OS's expected layout.
 */
export function resolveTauriPaths(identifier: string): {
  darwin: TauriPathSet;
  linux: TauriPathSet;
  win32: TauriPathSet;
} {
  const home = homedir();

  // ── macOS ────────────────────────────────────────────────
  const darwinHome = process.platform === 'darwin' ? home : `/Users/<user>`;
  const darwinAppSupport = `${darwinHome}/Library/Application Support/${identifier}`;
  const darwin: TauriPathSet = {
    appConfigDir: darwinAppSupport,
    appDataDir: darwinAppSupport,
    appLocalDataDir: darwinAppSupport,
    appCacheDir: `${darwinHome}/Library/Caches/${identifier}`,
    appLogDir: `${darwinHome}/Library/Logs/${identifier}`,
  };

  // ── Linux ────────────────────────────────────────────────
  const linuxHome = process.platform === 'linux' ? home : '/home/<user>';
  const xdgData =
    (process.platform === 'linux' ? process.env['XDG_DATA_HOME'] : null) ||
    `${linuxHome}/.local/share`;
  const xdgConfig =
    (process.platform === 'linux' ? process.env['XDG_CONFIG_HOME'] : null) ||
    `${linuxHome}/.config`;
  const xdgCache =
    (process.platform === 'linux' ? process.env['XDG_CACHE_HOME'] : null) ||
    `${linuxHome}/.cache`;
  const linux: TauriPathSet = {
    appConfigDir: `${xdgConfig}/${identifier}`,
    appDataDir: `${xdgData}/${identifier}`,
    appLocalDataDir: `${xdgData}/${identifier}`,
    appCacheDir: `${xdgCache}/${identifier}`,
    appLogDir: `${xdgData}/${identifier}/logs`,
  };

  // ── Windows ──────────────────────────────────────────────
  const winAppData =
    (process.platform === 'win32' ? process.env['APPDATA'] : null) ??
    'C:\\Users\\<user>\\AppData\\Roaming';
  const winLocalAppData =
    (process.platform === 'win32' ? process.env['LOCALAPPDATA'] : null) ??
    'C:\\Users\\<user>\\AppData\\Local';
  const win32: TauriPathSet = {
    appConfigDir: `${winAppData}\\${identifier}`,
    appDataDir: `${winAppData}\\${identifier}`,
    appLocalDataDir: `${winLocalAppData}\\${identifier}`,
    appCacheDir: `${winLocalAppData}\\${identifier}`,
    appLogDir: `${winLocalAppData}\\${identifier}\\logs`,
  };

  return { darwin, linux, win32 };
}

export function currentPlatform(): 'darwin' | 'linux' | 'win32' {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win32';
  return 'linux';
}

/**
 * Discover capability JSON files under `<projectDir>/src-tauri/capabilities/` (or
 * `<projectDir>/capabilities/` when the user pointed --config at src-tauri itself).
 */
export async function findCapabilityFiles(
  projectDir: string,
  override?: string,
): Promise<string[]> {
  const candidates = override
    ? [isAbsolute(override) ? override : join(projectDir, override)]
    : [join(projectDir, 'capabilities'), join(projectDir, 'src-tauri', 'capabilities')];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
  }
  return [];
}

export async function loadCapability(filePath: string): Promise<Capability> {
  const text = await readFile(filePath, 'utf-8');
  let parsed: unknown;
  try { parsed = JSON5.parse(text); }
  catch (error) { throw new Error(`Could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  return CapabilitySchema.parse(parsed);
}

/**
 * Compose loadTauriConfig + identifier/product/path resolution + capability discovery
 * into a single structured snapshot. Used by app-paths, config inspect, os-logs,
 * and forensics — each picks the fields it needs.
 */
export async function resolveTauriProject(
  opts: ConfigLoadOptions & { identifierOverride?: string; capabilitiesDir?: string } = {},
): Promise<ResolvedTauriConfig> {
  const loaded = await loadTauriConfig(opts);
  const fallbackName = loaded.projectDir.split(/[\\/]/).pop() ?? 'app';

  const identifier = opts.identifierOverride ?? resolveIdentifier(loaded.raw);
  const productName = resolveProductName(loaded.raw, fallbackName);
  const paths = resolveTauriPaths(identifier);
  const capabilityFiles = await findCapabilityFiles(loaded.projectDir, opts.capabilitiesDir);

  const windows = (loaded.raw.app?.windows ?? [])
    .map((w) => w.label)
    .filter((l): l is string => typeof l === 'string' && l.length > 0);

  return {
    configPath: loaded.configPath,
    identifier,
    productName,
    version: loaded.raw.version ?? null,
    mainBinaryName: loaded.raw.mainBinaryName ?? null,
    devUrl: loaded.raw.build?.devUrl ?? loaded.raw.build?.devPath ?? null,
    devPort: resolveDevPort(loaded.raw),
    frontendDist: loaded.raw.build?.frontendDist ?? loaded.raw.build?.distDir ?? null,
    sidecars: loaded.raw.bundle?.externalBin ?? [],
    windows,
    capabilityFiles,
    paths,
    platform: currentPlatform(),
  };
}
