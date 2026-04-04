import { z } from 'zod';

// === Token Discovery ===

export const TokenFileSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
  pid: z.number().int().positive(),
});
export type TokenFile = z.infer<typeof TokenFileSchema>;

// === Bridge Types ===

export const ElementRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ElementRect = z.infer<typeof ElementRectSchema>;

export const BridgeConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

export const ViewportSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});
export type ViewportSize = z.infer<typeof ViewportSizeSchema>;

export const RustLogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error']);
export type RustLogLevel = z.infer<typeof RustLogLevelSchema>;

export const RustLogEntrySchema = z.object({
  timestamp: z.number(),
  level: RustLogLevelSchema,
  target: z.string(),
  message: z.string(),
  source: z.string(),
});
export type RustLogEntry = z.infer<typeof RustLogEntrySchema>;

// === Bridge HTTP Responses ===

export const BridgeEvalResponseSchema = z.object({
  result: z.unknown(),
});

export const BridgeLogsResponseSchema = z.object({
  entries: z.array(RustLogEntrySchema),
});

// === Probe / Discovery Responses ===

export const DescribeResponseSchema = z.object({
  app: z.string().optional(),
  pid: z.number().optional(),
  windows: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  surfaces: z.record(z.string(), z.string()).optional(),
  exports: z.record(z.string(), z.string()).optional(),
});
export type DescribeResponse = z.infer<typeof DescribeResponseSchema>;

export const VersionResponseSchema = z.object({
  version: z.string(),
  endpoints: z.array(z.string()),
});
export type VersionResponse = z.infer<typeof VersionResponseSchema>;
