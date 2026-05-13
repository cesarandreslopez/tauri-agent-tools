import { z } from 'zod';

export const OsLogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type OsLogLevel = z.infer<typeof OsLogLevelSchema>;

export const OsLogSourceSchema = z.enum(['main', 'webview', 'sidecar', 'all']);
export type OsLogSource = z.infer<typeof OsLogSourceSchema>;

/**
 * Normalized log envelope emitted by `os-logs`. The raw upstream payload
 * (macOS log JSON, journalctl JSON, …) is preserved in `raw` so consumers
 * can recover any platform-specific field that didn't make it into the
 * normalized projection.
 */
export const NormalizedLogEntrySchema = z.object({
  ts: z.string(),
  level: OsLogLevelSchema,
  source: z.string(),
  subsystem: z.string(),
  message: z.string(),
  raw: z.unknown(),
});
export type NormalizedLogEntry = z.infer<typeof NormalizedLogEntrySchema>;
