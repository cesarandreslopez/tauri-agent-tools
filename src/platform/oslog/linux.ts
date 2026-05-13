import type { NormalizedLogEntry, OsLogLevel } from '../../schemas/osLog.js';

export interface LinuxSpawnArgs {
  identifier: string;
  productName: string;
  since?: string;
}

/**
 * Build `journalctl` args. We use `--user` (current user's systemd journal),
 * `-f` to follow, `-o json` for structured output, and `-t` to filter by
 * SYSLOG_IDENTIFIER. The product name is the most reliable identifier here
 * because that's what Rust's `env_logger`/`log` typically uses, but we also
 * accept the bundle id as a fallback subsystem match.
 */
export function buildArgs({ identifier, productName, since }: LinuxSpawnArgs): string[] {
  const args = ['--user', '-f', '-o', 'json', '-t', productName, '-t', identifier];
  if (since) args.push('--since', since);
  return args;
}

export function parseLine(line: string): NormalizedLogEntry | null {
  if (!line.trim().startsWith('{')) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  // journalctl `__REALTIME_TIMESTAMP` is microseconds since epoch as a string.
  const tsMicros = raw['__REALTIME_TIMESTAMP'];
  const ts =
    typeof tsMicros === 'string' && /^\d+$/.test(tsMicros)
      ? new Date(Math.floor(Number(tsMicros) / 1000)).toISOString()
      : new Date().toISOString();

  // syslog priorities: 0=emerg .. 7=debug. journalctl exposes PRIORITY as a string.
  const priorityRaw = raw['PRIORITY'];
  const level = mapJournalPriority(
    typeof priorityRaw === 'string' ? Number(priorityRaw) : Number(priorityRaw ?? 6),
  );

  const subsystem = String(raw['SYSLOG_IDENTIFIER'] ?? '');
  const message = String(raw['MESSAGE'] ?? '');
  const source = 'main';

  return { ts, level, source, subsystem, message, raw };
}

function mapJournalPriority(priority: number): OsLogLevel {
  if (priority <= 3) return 'error'; // emerg/alert/crit/err
  if (priority === 4) return 'warn';
  if (priority === 5 || priority === 6) return 'info';
  return 'debug';
}

export const COMMAND = 'journalctl';
