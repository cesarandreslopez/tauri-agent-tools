import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge } from './shared.js';
import { StorageEntrySchema } from '../schemas.js';
import type { StorageEntry } from '../schemas.js';

function escapeQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildLocalStorageScript(key?: string): string {
  if (key) {
    return `localStorage.getItem('${escapeQuotes(key)}')`;
  }
  return `JSON.stringify(Object.keys(localStorage).map(function(k) { return { key: k, value: localStorage.getItem(k) }; }))`;
}

function buildSessionStorageScript(key?: string): string {
  if (key) {
    return `sessionStorage.getItem('${escapeQuotes(key)}')`;
  }
  return `JSON.stringify(Object.keys(sessionStorage).map(function(k) { return { key: k, value: sessionStorage.getItem(k) }; }))`;
}

function buildCookiesScript(): string {
  return `document.cookie`;
}

function parseCookies(cookieString: string): StorageEntry[] {
  if (!cookieString || !cookieString.trim()) return [];
  return cookieString.split('; ').map((pair) => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) return { key: pair, value: null };
    return { key: pair.slice(0, eqIdx), value: pair.slice(eqIdx + 1) };
  });
}

function formatSection(name: string, entries: StorageEntry[]): string {
  const count = entries.length;
  const label = count === 1 ? 'entry' : 'entries';
  const lines = [`${name} (${count} ${label})`];
  for (const e of entries) {
    lines.push(`  ${e.key} = ${e.value === null ? '(no value)' : JSON.stringify(e.value)}`);
  }
  return lines.join('\n');
}

export function registerStorage(program: Command): void {
  const cmd = new Command('storage')
    .description('Inspect localStorage, sessionStorage, and cookies')
    .option('--type <type>', 'Storage type: local, session, cookies, all', 'all')
    .option('--key <name>', 'Get a specific key value')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(
    async (opts: {
      type: string;
      key?: string;
      json?: boolean;
      port?: number;
      token?: string;
    }) => {
      const validTypes = ['local', 'session', 'cookies', 'all'];
      if (!validTypes.includes(opts.type)) {
        throw new Error(`Invalid storage type: ${opts.type}. Must be one of: ${validTypes.join(', ')}`);
      }

      const bridge = await resolveBridge(opts);
      const result: Record<string, unknown> = {};

      if (opts.type === 'local' || opts.type === 'all') {
        const raw = await bridge.eval(buildLocalStorageScript(opts.key));
        if (opts.key) {
          result.localStorage = raw;
        } else {
          result.localStorage = z.array(StorageEntrySchema).parse(JSON.parse(String(raw)));
        }
      }

      if (opts.type === 'session' || opts.type === 'all') {
        const raw = await bridge.eval(buildSessionStorageScript(opts.key));
        if (opts.key) {
          result.sessionStorage = raw;
        } else {
          result.sessionStorage = z.array(StorageEntrySchema).parse(JSON.parse(String(raw)));
        }
      }

      if (opts.type === 'cookies' || opts.type === 'all') {
        if (opts.key) {
          const raw = await bridge.eval(buildCookiesScript());
          const cookies = parseCookies(String(raw));
          const match = cookies.find((c) => c.key === opts.key);
          result.cookies = match ? match.value : null;
        } else {
          const raw = await bridge.eval(buildCookiesScript());
          result.cookies = parseCookies(String(raw));
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (opts.key) {
          for (const [store, value] of Object.entries(result)) {
            console.log(`${store}: ${value === null ? '(not found)' : String(value)}`);
          }
        } else {
          const sections: string[] = [];
          if (result.localStorage) {
            sections.push(formatSection('localStorage', result.localStorage as StorageEntry[]));
          }
          if (result.sessionStorage) {
            sections.push(
              formatSection('sessionStorage', result.sessionStorage as StorageEntry[]),
            );
          }
          if (result.cookies) {
            sections.push(formatSection('cookies', result.cookies as StorageEntry[]));
          }
          console.log(sections.join('\n\n'));
        }
      }
    },
  );

  program.addCommand(cmd);
}
