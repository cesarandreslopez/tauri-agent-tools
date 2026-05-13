import type { NormalizedLogEntry, OsLogLevel } from '../../schemas/osLog.js';

export interface DarwinSpawnArgs {
  identifier: string;
  productName: string;
  since?: string;
}

/**
 * Build `log stream` args for the macOS unified log. We filter by either the
 * subsystem (matches `OSLog.Logger`/Rust `tracing` subsystem when configured)
 * or by sender image path (catches everything the app process emits even when
 * the subsystem isn't set). Returns argv suitable for execFile.
 */
export function buildArgs({ identifier, productName, since }: DarwinSpawnArgs): string[] {
  const predicate = `subsystem == "${identifier}" OR senderImagePath CONTAINS[c] "${productName}"`;
  const args = ['stream', '--predicate', predicate, '--style', 'ndjson'];
  if (since) {
    // `log stream` doesn't support --start directly; we accept the flag and
    // surface it to the caller, but the actual time-based filter must be done
    // client-side via `--last`/`show`. For `stream`, --since is informational.
    // Callers wanting historical logs should use a separate `log show` variant.
  }
  return args;
}

/**
 * Parse a single `log stream --style ndjson` line into our normalized shape.
 * Returns null when the line is metadata (e.g., the initial "Filtering the
 * log data using…" line which is not valid JSON).
 */
export function parseLine(line: string): NormalizedLogEntry | null {
  if (!line.trim().startsWith('{')) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const ts =
    typeof raw['timestamp'] === 'string'
      ? (raw['timestamp'] as string)
      : new Date().toISOString();

  // macOS log levels: Default, Info, Debug, Error, Fault. Coerce to our 4-level
  // taxonomy.
  const typeRaw = String(raw['messageType'] ?? raw['eventMessage'] ?? 'Default');
  const level = mapDarwinLevel(typeRaw);

  const subsystem = String(raw['subsystem'] ?? '');
  const senderImage = String(raw['senderImagePath'] ?? '');
  const source = inferSource(senderImage);
  const message = String(raw['eventMessage'] ?? raw['message'] ?? '');

  return { ts, level, source, subsystem, message, raw };
}

function mapDarwinLevel(typeRaw: string): OsLogLevel {
  // macOS log emits canonical types: Default, Info, Debug, Error, Fault.
  // Match the exact token (case-insensitive) rather than substring, otherwise
  // "Default" gets misclassified as an error because it contains "fault".
  switch (typeRaw.toLowerCase()) {
    case 'fault':
    case 'error':
      return 'error';
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'default':
    default:
      return 'info';
  }
}

function inferSource(senderImagePath: string): string {
  // Apple's WebKit lives at /System/Library/Frameworks/WebKit.framework/…
  if (/WebKit|com\.apple\.WebKit/i.test(senderImagePath)) return 'webview';
  // App's main binary path will end with the executable name; everything else is "main".
  return 'main';
}

/** The actual command binary the adapter shells out to. */
export const COMMAND = 'log';
