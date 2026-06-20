import type { OsLogLevel } from '../schemas/osLog.js';
import type { RustLogEntry } from '../schemas/bridge.js';

/**
 * One entry in a merged, cross-source log timeline. Superset of the normalized
 * `os-logs` shape (kept local so the shared `NormalizedLogEntry` schema — and
 * the commands validated against it — are untouched).
 */
export interface MergedLogEntry {
  /** ISO-8601 timestamp, or '' when unknown. */
  ts: string;
  level: OsLogLevel;
  /** 'rust' | 'sidecar:<name>' (bridge) or 'file:<basename>' (disk). */
  source: string;
  /** Target/module path, best-effort. */
  subsystem: string;
  message: string;
  origin: 'bridge' | 'file';
  correlation?: Record<string, string>;
  raw?: unknown;
}

export const LEVEL_RANK: Record<OsLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_ALIASES: Record<string, OsLogLevel> = {
  trace: 'debug',
  debug: 'debug',
  dbg: 'debug',
  info: 'info',
  information: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'error',
  crit: 'error',
  critical: 'error',
};

function looksLikeTimestampPart(token: string): boolean {
  return (
    /\d{4}-\d{2}-\d{2}/.test(token) ||
    /\d{1,2}:\d{2}:\d{2}/.test(token) ||
    /^\d{10,13}$/.test(token)
  );
}

/**
 * Normalize a timestamp candidate so `Date.parse` reads it deterministically:
 * unify "date time" → "dateTtime" and, when a time component has no explicit
 * timezone, treat it as UTC (append `Z`). This keeps cross-source ordering — and
 * the emitted ISO output — independent of the host machine's timezone.
 */
function normalizeForParse(s: string): string {
  let v = s.trim();
  v = v.replace(/^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2})/, '$1T$2');
  const hasTime = /T\d{2}:\d{2}/.test(v) || /^\d{1,2}:\d{2}:\d{2}/.test(v);
  const hasTz = /[zZ]$/.test(v) || /[+-]\d{2}:?\d{2}$/.test(v);
  if (hasTime && !hasTz) v += 'Z';
  return v;
}

function combineTimestamp(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1 && /^\d{10,13}$/.test(parts[0]!)) {
    const raw = parts[0]!;
    const ms = raw.length <= 10 ? Number(raw) * 1000 : Number(raw);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const candidates = [parts.join('T'), parts.join(' '), parts.join(''), ...parts];
  for (const c of candidates) {
    const t = Date.parse(normalizeForParse(c));
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return '';
}

function inferInlineLevel(text: string): OsLogLevel {
  const m = /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b/i.exec(text);
  if (!m) return 'info';
  return LEVEL_ALIASES[m[1]!.toLowerCase()] ?? 'info';
}

export interface ParsedLine {
  ts: string;
  level: OsLogLevel;
  subsystem: string;
  message: string;
}

/**
 * Best-effort parse of one on-disk log line. Pulls leading bracketed tokens
 * (`[ts][target][LEVEL]` in any order) when present; otherwise treats the whole
 * line as the message and infers the level from inline text. Never throws — an
 * unrecognized line still yields a usable entry (ts='', level='info').
 */
export function parseLogLine(line: string): ParsedLine {
  const m = /^\s*((?:\[[^\]]*\]\s*)+)(.*)$/.exec(line);
  if (!m) {
    return { ts: '', level: inferInlineLevel(line), subsystem: '', message: line.trim() };
  }
  const tokens = [...m[1]!.matchAll(/\[([^\]]*)\]/g)]
    .map((x) => x[1]!.trim())
    .filter(Boolean);
  const message = (m[2] ?? '').trim();

  let level: OsLogLevel = 'info';
  let levelFound = false;
  let subsystem = '';
  const tsParts: string[] = [];

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (!levelFound && lower in LEVEL_ALIASES) {
      level = LEVEL_ALIASES[lower]!;
      levelFound = true;
      continue;
    }
    if (looksLikeTimestampPart(tok)) {
      tsParts.push(tok);
      continue;
    }
    if (!subsystem) subsystem = tok;
  }
  if (!levelFound) level = inferInlineLevel(message);

  return {
    ts: combineTimestamp(tsParts),
    level,
    subsystem,
    message: message || line.trim(),
  };
}

/** Normalize a bridge /logs ring-buffer entry into a MergedLogEntry. */
export function normalizeRustLog(e: RustLogEntry): MergedLogEntry {
  return {
    ts: new Date(e.timestamp).toISOString(),
    level: e.level === 'trace' ? 'debug' : e.level,
    source: e.source,
    subsystem: e.target,
    message: e.message,
    origin: 'bridge',
    raw: e,
  };
}

const ID_RE = /\b([a-zA-Z][\w]*?(?:[_-]?id))\s*[=:]\s*["']?([\w.\-/]+)/gi;

/**
 * Best-effort correlation-id inference from a message (e.g. `run_id=abc`,
 * `requestId: xyz`, `block-id=42`). Keys shorter than 4 chars (like `pid`) are
 * ignored to cut noise. Returns undefined when nothing is found.
 */
export function inferCorrelation(message: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ID_RE.exec(message)) !== null) {
    const rawKey = m[1]!;
    if (rawKey.length < 4) continue;
    const key = rawKey.replace(/[_-]?id$/i, 'Id');
    if (!(key in out)) out[key] = m[2]!;
  }
  return Object.keys(out).length ? out : undefined;
}
