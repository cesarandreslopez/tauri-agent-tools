import { readdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BridgeConfig } from '../schemas/bridge.js';
import { TokenFileSchema } from '../schemas/bridge.js';

const FALLBACK_TOKEN_DIR = '/tmp';
const TOKEN_PREFIX = 'tauri-dev-bridge-';
const TOKEN_SUFFIX = '.token';

interface DiscoveredBridge {
  pid: number;
  config: BridgeConfig;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getTokenDirs(): string[] {
  return [...new Set([tmpdir(), FALLBACK_TOKEN_DIR])];
}

async function scanTokenDir(tokenDir: string): Promise<DiscoveredBridge[]> {
  let files: string[];
  try {
    files = await readdir(tokenDir);
  } catch {
    return [];
  }

  const tokenFiles = files.filter(
    (f) => f.startsWith(TOKEN_PREFIX) && f.endsWith(TOKEN_SUFFIX),
  );

  const found: DiscoveredBridge[] = [];

  for (const file of tokenFiles) {
    const filePath = join(tokenDir, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = TokenFileSchema.parse(JSON.parse(content));

      if (!isPidAlive(data.pid)) {
        // Clean stale token files from dead processes
        await unlink(filePath).catch(() => {});
        continue;
      }

      found.push({
        pid: data.pid,
        config: { port: data.port, token: data.token },
      });
    } catch {
      // Skip malformed files
      continue;
    }
  }

  return found;
}

export async function discoverBridge(): Promise<BridgeConfig | null> {
  let first: BridgeConfig | null = null;

  for (const tokenDir of getTokenDirs()) {
    const bridges = await scanTokenDir(tokenDir);
    if (!first && bridges.length > 0) {
      first = bridges[0]!.config;
    }
  }

  return first;
}

export async function discoverBridgesByPid(): Promise<Map<number, BridgeConfig>> {
  const result = new Map<number, BridgeConfig>();

  for (const tokenDir of getTokenDirs()) {
    const bridges = await scanTokenDir(tokenDir);
    for (const bridge of bridges) {
      if (!result.has(bridge.pid)) {
        result.set(bridge.pid, bridge.config);
      }
    }
  }

  return result;
}
