import type { RustLogEntry } from '../schemas/bridge.js';

export const LOG_CURSOR_UNAVAILABLE_NOTE =
  'bridge <0.8 has no log cursor; using drain polling (entries may be lost between polls)';

export interface LogCursor {
  cursor: number;
  drainFallback: boolean;
  warnedDrainFallback: boolean;
}

export function newLogCursor(): LogCursor {
  return { cursor: 0, drainFallback: false, warnedDrainFallback: false };
}

interface LogClient {
  fetchLogs(arg?: number | { cursor?: number; waitMs?: number; limit?: number; timeoutMs?: number }):
    Promise<RustLogEntry[] | { entries: RustLogEntry[]; cursor?: number; dropped?: number }>;
}

export async function readRustLogs(
  client: LogClient,
  state: LogCursor = newLogCursor(),
  options: { waitMs?: number; limit?: number; intervalMs?: number; warn?: (message: string) => void } = {},
): Promise<RustLogEntry[]> {
  const warn = options.warn ?? console.error;
  const response = state.drainFallback
    ? await client.fetchLogs(Math.max(options.intervalMs ?? 2000, 2000))
    : await client.fetchLogs({ cursor: state.cursor, waitMs: options.waitMs ?? 0,
      limit: options.limit ?? 1000, timeoutMs: Math.max(5000, (options.waitMs ?? 0) + 1000) });
  const batch = Array.isArray(response) ? { entries: response } : response;
  if (batch.cursor === undefined) {
    state.drainFallback = true;
    if (!state.warnedDrainFallback) {
      state.warnedDrainFallback = true;
      warn(`note: ${LOG_CURSOR_UNAVAILABLE_NOTE}`);
    }
  } else {
    state.cursor = batch.cursor;
    if (batch.dropped) warn(`warning: bridge log cursor dropped ${batch.dropped} evicted entries`);
  }
  return batch.entries;
}
