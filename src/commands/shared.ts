import type { Command } from 'commander';
import type { z } from 'zod';
import type { BridgeConfig } from '../schemas/bridge.js';
import type { PlatformAdapter } from '../types.js';
import { BridgeClient } from '../bridge/client.js';
import { discoverBridge, discoverBridgesByPid } from '../bridge/tokenDiscovery.js';
import { CliError } from '../util/errors.js';

/**
 * Options parsed from the bridge-related CLI flags.
 */
export interface BridgeOpts {
  port?: number;
  token?: string;
  pid?: number;
  windowLabel?: string;
  /**
   * When true, commands that depend on a v0.7+ bridge endpoint throw the
   * actionable "requires bridge vX" error instead of degrading. Default
   * (false) = degrade gracefully. See {@link endpointAvailable}.
   */
  strict?: boolean;
}

/**
 * Options parsed from the window-targeting CLI flags.
 */
export interface WindowTargetOpts {
  windowId?: string;
  title?: string;
}

/**
 * Resolve the platform window id for a window-consuming command.
 * Precedence: --window-id (used verbatim) > --title pattern > bridge document.title.
 *
 * The id is not validated here: its format is adapter-specific (X11/macOS/Sway
 * numeric, Hyprland hex 0x…), and the adapters that interpolate ids into shell
 * commands already guard with validateWindowId().
 */
export async function resolveWindowId(
  adapter: PlatformAdapter,
  bridge: BridgeClient,
  opts: WindowTargetOpts,
): Promise<string> {
  if (opts.windowId) return opts.windowId;
  if (opts.title) return adapter.findWindow(opts.title);
  const docTitle = await bridge.getDocumentTitle();
  if (!docTitle) {
    throw new Error('Could not get window title from bridge. Use --title or --window-id.');
  }
  return adapter.findWindow(docTitle);
}

/**
 * Parse a value with a Zod enum schema, throwing a human-readable error on failure.
 * Replaces raw `.parse()` calls that would surface cryptic ZodError messages.
 */
export function parseEnum<T extends [string, ...string[]]>(
  schema: z.ZodEnum<T>,
  value: string,
  label: string,
): T[number] {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${label}: ${value}. Must be one of: ${schema.options.join(', ')}`);
  }
  return result.data;
}

/**
 * Base-10 integer coercion for commander options. Never pass bare `parseInt`
 * as a coercion: commander calls it as (value, previousValue), so an option
 * default becomes the radix — `--depth 12` with default 3 parsed as 5.
 */
export function parseIntArg(value: string): number {
  const n = Number(value);
  if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(n)) {
    throw new CliError('INVALID_ARGUMENT', `Expected an integer, got: ${value}`, 'Use a whole number without units or trailing text.');
  }
  return n;
}

export function parseNonNegativeInt(value: string): number {
  const n = parseIntArg(value);
  if (n < 0) throw new CliError('INVALID_ARGUMENT', `Expected a non-negative integer, got: ${value}`, 'Use zero or a positive whole number.');
  return n;
}

export function parsePositiveInt(value: string): number {
  const n = parseIntArg(value);
  if (n <= 0 || n > 2_147_483_647) throw new CliError('INVALID_ARGUMENT', `Expected a positive integer up to 2147483647, got: ${value}`, 'Use a positive whole number.');
  return n;
}

function parsePort(value: string): number {
  const n = parsePositiveInt(value);
  if (n > 65535) throw new CliError('INVALID_ARGUMENT', `Invalid port: ${value}`, 'Use a port from 1 to 65535.');
  return n;
}

export function parsePercent(value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new CliError('INVALID_ARGUMENT', `Invalid percentage: ${value}`, 'Use a number from 0 to 100.');
  }
  return n;
}

export function addBridgeOptions(cmd: Command): Command {
  return cmd
    .option('--port <number>', 'Bridge port (auto-discover if omitted)', parsePort)
    .option('--token <string>', 'Bridge token (auto-discover if omitted)')
    .option('--pid <number>', 'Target app PID (auto-discover if omitted)', parsePositiveInt)
    .option('--window-label <label>', 'Target window label (default: main)')
    .option(
      '--strict',
      'Fail (instead of degrading) when the bridge lacks a required v0.7+ endpoint',
    );
}

/**
 * Non-throwing gate for a v0.7+ bridge endpoint. Returns true when the caller
 * should proceed to use the endpoint, false when it should degrade.
 *
 * - In `--strict` mode it always returns true, so the subsequent throwing call
 *   (e.g. `bridge.process()`) surfaces the actionable "requires bridge vX" error
 *   — preserving the pre-v0.8 behavior for callers that opt in.
 * - Otherwise it feature-detects via `/version` (cached) and returns whether the
 *   endpoint is advertised, letting the command fall back instead of throwing.
 */
export async function endpointAvailable(
  bridge: BridgeClient,
  path: string,
  opts: { strict?: boolean },
): Promise<boolean> {
  if (opts.strict) return true;
  return bridge.hasEndpoint(path);
}

/**
 * Standard one-line note explaining that a v0.7+ endpoint is absent on the
 * running bridge, with the same remediation hint `requireEndpoint` uses.
 */
export function endpointUnavailableNote(path: string, version?: string | null): string {
  const v = version ? ` (this app reports bridge v${version})` : '';
  return (
    `${path} is not available on the running bridge${v}. ` +
    `Re-copy examples/tauri-bridge/src/dev_bridge.rs and rebuild to enable it — ` +
    `or pass --strict to fail instead of degrading.`
  );
}

/**
 * Resolve a bridge config WITHOUT throwing — returns null when no bridge is
 * reachable. Use this in best-effort, bridge-optional commands (`logs`,
 * `bundle`) that should still produce output when no app is running.
 */
export async function tryResolveBridgeConfig(opts: BridgeOpts): Promise<BridgeConfig | null> {
  try {
    if (opts.port && opts.token) return { port: opts.port, token: opts.token };
    if (opts.pid !== undefined) {
      const bridges = await discoverBridgesByPid();
      const match = bridges.get(opts.pid);
      if (!match) return null;
      return { port: opts.port ?? match.port, token: opts.token ?? match.token };
    }
    const discovered = await discoverBridge();
    if (!discovered) return null;
    return { port: opts.port ?? discovered.port, token: opts.token ?? discovered.token };
  } catch {
    return null;
  }
}

export async function resolveBridge(opts: BridgeOpts): Promise<BridgeClient> {
  let config: BridgeConfig;

  if (opts.port && opts.token) {
    // Explicit port + token: skip discovery entirely
    config = { port: opts.port, token: opts.token };
  } else if (opts.pid !== undefined) {
    // PID-targeted discovery
    const bridges = await discoverBridgesByPid();
    const match = bridges.get(opts.pid);
    if (!match) {
      const pids = [...bridges.keys()];
      const listing =
        pids.length > 0
          ? `Running bridges:\n${pids.map((p) => `  PID ${p}`).join('\n')}`
          : 'No running bridges found.';
      throw new Error(
        `No bridge found for PID ${opts.pid}.\n${listing}`,
      );
    }
    config = {
      port: opts.port ?? match.port,
      token: opts.token ?? match.token,
    };
  } else {
    // First-match discovery
    const discovered = await discoverBridge();
    if (!discovered) {
      throw new Error(
        'No bridge found. Either:\n' +
          '  1. Start the Tauri dev bridge in your app, or\n' +
          '  2. Specify --port and --token manually',
      );
    }
    config = {
      port: opts.port ?? discovered.port,
      token: opts.token ?? discovered.token,
    };
  }

  return new BridgeClient(config, opts.windowLabel);
}
