import { readdir, readFile, unlink } from 'node:fs/promises';
import type { BridgeConfig } from '../types.js';

const TOKEN_DIR = '/tmp';
const TOKEN_PREFIX = 'tauri-dev-bridge-';
const TOKEN_SUFFIX = '.token';

interface TokenFile {
  port: number;
  token: string;
  pid: number;
}

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
      const data: TokenFile = JSON.parse(content);

      if (!data.port || !data.token || !data.pid) continue;

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
