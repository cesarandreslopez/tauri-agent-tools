import { readdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { BridgeConfig } from '../types.js';
import { TokenFileSchema } from '../schemas/bridge.js';

const TOKEN_DIR = tmpdir();
const TOKEN_PREFIX = 'tauri-dev-bridge-';
const TOKEN_SUFFIX = '.token';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function discoverBridge(): Promise<BridgeConfig | null> {
  let files: string[];
  try {
    files = await readdir(TOKEN_DIR);
  } catch {
    return null;
  }

  const tokenFiles = files.filter(
    (f) => f.startsWith(TOKEN_PREFIX) && f.endsWith(TOKEN_SUFFIX),
  );

  let found: BridgeConfig | null = null;

  for (const file of tokenFiles) {
    const filePath = `${TOKEN_DIR}/${file}`;
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = TokenFileSchema.parse(JSON.parse(content));

      if (!isPidAlive(data.pid)) {
        // Clean stale token files from dead processes
        await unlink(filePath).catch(() => {});
        continue;
      }

      if (!found) {
        found = { port: data.port, token: data.token };
      }
    } catch {
      // Skip malformed files
      continue;
    }
  }

  return found;
}

export async function discoverBridgesByPid(): Promise<Map<number, BridgeConfig>> {
  const result = new Map<number, BridgeConfig>();

  let files: string[];
  try {
    files = await readdir(TOKEN_DIR);
  } catch {
    return result;
  }

  const tokenFiles = files.filter(
    (f) => f.startsWith(TOKEN_PREFIX) && f.endsWith(TOKEN_SUFFIX),
  );

  for (const file of tokenFiles) {
    const filePath = `${TOKEN_DIR}/${file}`;
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = TokenFileSchema.parse(JSON.parse(content));

      if (!isPidAlive(data.pid)) {
        await unlink(filePath).catch(() => {});
        continue;
      }

      result.set(data.pid, { port: data.port, token: data.token });
    } catch {
      continue;
    }
  }

  return result;
}
