import { Command } from 'commander';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { addBridgeOptions, tryResolveBridgeConfig } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { BridgeClient } from '../bridge/client.js';
import { resolveTauriProject, resolveTauriPaths, currentPlatform } from '../util/tauriConfig.js';
import { mergeByTimestamp } from '../util/mergeByTimestamp.js';
import {
  parseLogLine,
  normalizeRustLog,
  inferCorrelation,
  LEVEL_RANK,
  type MergedLogEntry,
} from '../util/logMerge.js';
import type { OsLogLevel } from '../schemas/osLog.js';

interface LogsOpts extends BridgeOpts {
  config?: string;
  identifier?: string;
  logDir?: string;
  logFile?: string[];
  /** commander negation: false when --no-bridge is passed, true otherwise. */
  bridge?: boolean;
  /** commander negation: false when --no-files is passed, true otherwise. */
  files?: boolean;
  level?: string;
  source?: string;
  filter?: string;
  correlate?: boolean;
  raw?: boolean;
  json?: boolean;
  pretty?: boolean;
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

export function registerLogs(program: Command): void {
  const cmd = new Command('logs')
    .description(
      "Merge a Tauri app's scattered logs (on-disk log files + bridge ring buffer) into one timestamp-ordered stream",
    )
    .option('--config <path>', 'Path to tauri.conf.json (or its dir). Auto-detected if omitted.')
    .option('--identifier <id>', 'Bundle identifier override (locates the OS log dir without a config)')
    .option('--log-dir <path>', 'Override the directory scanned for *.log files')
    .option('--log-file <path>', 'Add an explicit log file (repeatable)', collect, [])
    .option('--no-bridge', 'Skip the live bridge /logs source')
    .option('--no-files', 'Skip on-disk log file sources')
    .option('--level <level>', 'Minimum level: debug | info | warn | error')
    .option('--source <regex>', 'Filter by normalized source (regex), e.g. "sidecar:" or "file:"')
    .option('--filter <regex>', 'Filter messages by regex')
    .option('--correlate', 'Infer correlation ids (run_id, requestId, …) into a correlation field')
    .option('--raw', 'Include the raw source payload/line in NDJSON output')
    .option('--json', 'Emit NDJSON, one object per line (this is the default; accepted for consistency)')
    .option('--pretty', 'Human-readable output (overrides --json)');

  addBridgeOptions(cmd);

  cmd.action(async (opts: LogsOpts) => {
    const minLevel = opts.level ? validateLevel(opts.level) : null;
    const sourceRe = opts.source ? compileRegex(opts.source, 'source') : null;
    const filterRe = opts.filter ? compileRegex(opts.filter, 'filter') : null;

    const notes: string[] = [];

    // ── On-disk file sources ────────────────────────────────────────────────
    let fileEntries: MergedLogEntry[] = [];
    if (opts.files !== false) {
      const files = await resolveFiles(opts, notes);
      const perFile = await Promise.all(files.map((f) => readLogFile(f)));
      fileEntries = perFile.flat();
      notes.push(`files: ${fileEntries.length} line(s) from ${files.length} file(s)`);
    }

    // ── Live bridge ring buffer ─────────────────────────────────────────────
    let bridgeEntries: MergedLogEntry[] = [];
    if (opts.bridge !== false) {
      const cfg = await tryResolveBridgeConfig(opts);
      if (!cfg) {
        notes.push('bridge: no live bridge discovered (skipped)');
      } else {
        try {
          const client = new BridgeClient(cfg, opts.windowLabel);
          const logs = await client.fetchLogs();
          bridgeEntries = logs.map(normalizeRustLog);
          notes.push(`bridge: ${bridgeEntries.length} entry(ies) from /logs`);
        } catch (e) {
          notes.push(`bridge: ${e instanceof Error ? e.message : String(e)} (skipped)`);
        }
      }
    }

    if (fileEntries.length === 0 && bridgeEntries.length === 0) {
      console.error(`note: no log entries available. ${notes.join('; ')}`);
      console.error(
        'Hint: pass --log-file <path>, --log-dir <dir>, --config <path>, or start the app with the dev bridge.',
      );
      return;
    }

    // ── Merge + filter ──────────────────────────────────────────────────────
    let merged = mergeByTimestamp<MergedLogEntry>([fileEntries, bridgeEntries]);
    merged = merged.filter((e) => {
      if (minLevel && LEVEL_RANK[e.level] < LEVEL_RANK[minLevel]) return false;
      if (sourceRe && !sourceRe.test(e.source)) return false;
      if (filterRe && !filterRe.test(e.message)) return false;
      return true;
    });
    if (opts.correlate) {
      merged = merged.map((e) => {
        const correlation = inferCorrelation(e.message);
        return correlation ? { ...e, correlation } : e;
      });
    }

    // ── Emit ────────────────────────────────────────────────────────────────
    console.error(`# ${notes.join(' | ')} → ${merged.length} entries`);
    if (opts.pretty) {
      for (const e of merged) console.log(formatPretty(e));
    } else {
      for (const e of merged) {
        if (opts.raw) {
          console.log(JSON.stringify(e));
        } else {
          const { raw: _raw, ...rest } = e;
          console.log(JSON.stringify(rest));
        }
      }
    }
  });

  program.addCommand(cmd);
}

async function resolveFiles(opts: LogsOpts, notes: string[]): Promise<string[]> {
  const set = new Set<string>();
  for (const f of opts.logFile ?? []) set.add(resolve(f));
  const dir = await resolveLogDir(opts, notes);
  if (dir) {
    for (const name of await listLogFiles(dir)) set.add(join(dir, name));
  }
  return [...set];
}

async function resolveLogDir(opts: LogsOpts, notes: string[]): Promise<string | null> {
  if (opts.logDir) return resolve(opts.logDir);
  try {
    let identifier: string;
    if (opts.identifier && !opts.config) {
      identifier = opts.identifier;
    } else {
      const r = await resolveTauriProject({ configPath: opts.config, identifierOverride: opts.identifier });
      identifier = r.identifier;
    }
    return resolveTauriPaths(identifier)[currentPlatform()].appLogDir;
  } catch (e) {
    notes.push(`log-dir: unresolved (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

async function listLogFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => /\.log(\.\d+|\.prev)?$/i.test(f));
  } catch {
    return [];
  }
}

async function readLogFile(path: string): Promise<MergedLogEntry[]> {
  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch {
    return [];
  }
  const base = basename(path);
  const out: MergedLogEntry[] = [];
  let lastTs = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') continue;
    const p = parseLogLine(line);
    if (p.ts) lastTs = p.ts;
    out.push({
      ts: p.ts || lastTs,
      level: p.level,
      source: `file:${base}`,
      subsystem: p.subsystem,
      message: p.message,
      origin: 'file',
      raw: line,
    });
  }
  return out;
}

function formatPretty(e: MergedLogEntry): string {
  const time = e.ts ? new Date(e.ts).toISOString().slice(11, 23) : '--:--:--.---';
  const lvl = e.level.toUpperCase().padEnd(5);
  const sub = e.subsystem ? ` ${e.subsystem}:` : '';
  const corr = e.correlation ? ` ${JSON.stringify(e.correlation)}` : '';
  return `[${time}] ${lvl} [${e.source}]${sub} ${e.message}${corr}`;
}

function validateLevel(input: string): OsLogLevel {
  if (input === 'debug' || input === 'info' || input === 'warn' || input === 'error') return input;
  throw new Error(`Invalid --level: ${input}. Expected one of: debug, info, warn, error.`);
}

function compileRegex(pattern: string, label: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    throw new Error(`Invalid ${label} regex: ${pattern}`);
  }
}
