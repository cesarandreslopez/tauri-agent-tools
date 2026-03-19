import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge } from './shared.js';
import { StorageEntrySchema, StorageTypeSchema } from '../schemas/commands.js';
import type { StorageEntry, StorageType } from '../schemas/commands.js';

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
      const parseResult = StorageTypeSchema.safeParse(opts.type);
      if (!parseResult.success) {
        throw new Error(`Invalid storage type: ${opts.type}. Must be one of: ${StorageTypeSchema.options.join(', ')}`);
      }
      const storageType: StorageType = parseResult.data;

      const bridge = await resolveBridge(opts);
      const keyResult: Record<string, string | null> = {};
      const listResult: Record<string, StorageEntry[]> = {};

      if (storageType === 'local' || storageType === 'all') {
        const raw = await bridge.eval(buildLocalStorageScript(opts.key));
        if (opts.key) {
          keyResult.localStorage = raw == null ? null : String(raw);
        } else {
          listResult.localStorage = z.array(StorageEntrySchema).parse(JSON.parse(String(raw)));
        }
      }

      if (storageType === 'session' || storageType === 'all') {
        const raw = await bridge.eval(buildSessionStorageScript(opts.key));
        if (opts.key) {
          keyResult.sessionStorage = raw == null ? null : String(raw);
        } else {
          listResult.sessionStorage = z.array(StorageEntrySchema).parse(JSON.parse(String(raw)));
        }
      }

      if (storageType === 'cookies' || storageType === 'all') {
        if (opts.key) {
          const raw = await bridge.eval(buildCookiesScript());
          const cookies = parseCookies(String(raw));
          const match = cookies.find((c) => c.key === opts.key);
          keyResult.cookies = match ? match.value : null;
        } else {
          const raw = await bridge.eval(buildCookiesScript());
          listResult.cookies = parseCookies(String(raw));
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(opts.key ? keyResult : listResult, null, 2));
      } else {
        if (opts.key) {
          for (const [store, value] of Object.entries(keyResult)) {
            console.log(`${store}: ${value === null ? '(not found)' : value}`);
          }
        } else {
          const sections: string[] = [];
          if (listResult.localStorage) {
            sections.push(formatSection('localStorage', listResult.localStorage));
          }
          if (listResult.sessionStorage) {
            sections.push(formatSection('sessionStorage', listResult.sessionStorage));
          }
          if (listResult.cookies) {
            sections.push(formatSection('cookies', listResult.cookies));
          }
          console.log(sections.join('\n\n'));
        }
      }
    },
  );

  program.addCommand(cmd);
}
