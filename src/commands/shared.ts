import type { Command } from 'commander';
import type { z } from 'zod';
import type { BridgeConfig } from '../schemas/bridge.js';
import { BridgeClient } from '../bridge/client.js';
import { discoverBridge, discoverBridgesByPid } from '../bridge/tokenDiscovery.js';

/**
 * Options parsed from the bridge-related CLI flags.
 */
export interface BridgeOpts {
  port?: number;
  token?: string;
  pid?: number;
  windowLabel?: string;
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

export interface BridgeOpts {
  port?: number;
  token?: string;
}

export function addBridgeOptions(cmd: Command): Command {
  return cmd
    .option('--port <number>', 'Bridge port (auto-discover if omitted)', parseInt)
    .option('--token <string>', 'Bridge token (auto-discover if omitted)')
    .option('--pid <number>', 'Target app PID (auto-discover if omitted)', parseInt)
    .option('--window-label <label>', 'Target window label (default: main)');
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
