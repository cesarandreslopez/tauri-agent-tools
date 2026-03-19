import type { Command } from 'commander';
import type { z } from 'zod';
import type { BridgeConfig } from '../schemas/bridge.js';
import { BridgeClient } from '../bridge/client.js';
import { discoverBridge } from '../bridge/tokenDiscovery.js';

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

export function addBridgeOptions(cmd: Command): Command {
  return cmd
    .option('--port <number>', 'Bridge port (auto-discover if omitted)', parseInt)
    .option('--token <string>', 'Bridge token (auto-discover if omitted)');
}

export async function resolveBridge(opts: {
  port?: number;
  token?: string;
}): Promise<BridgeClient> {
  let config: BridgeConfig;

  if (opts.port && opts.token) {
    config = { port: opts.port, token: opts.token };
  } else {
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

  return new BridgeClient(config);
}
