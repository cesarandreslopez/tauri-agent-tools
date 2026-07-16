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
  id: z.number().int().nonnegative().optional(),
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
  cursor: z.number().int().nonnegative().optional(),
  dropped: z.number().int().nonnegative().optional(),
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

// === /process ===

export const SidecarSummarySchema = z.object({
  name: z.string(),
  pid: z.number().int(),
  exe: z.string().optional(),
  args: z.array(z.string()),
  alive: z.boolean().nullable().optional(),
});
export type SidecarSummary = z.infer<typeof SidecarSummarySchema>;

export const TauriProcessInfoSchema = z.object({
  pid: z.number().int(),
  exe: z.string().optional(),
  args: z.array(z.string()),
  uptime_ms: z.number().int(),
});
export type TauriProcessInfo = z.infer<typeof TauriProcessInfoSchema>;

export const ProcessResponseSchema = z.object({
  tauri: TauriProcessInfoSchema,
  sidecars: z.array(SidecarSummarySchema),
});
export type ProcessResponse = z.infer<typeof ProcessResponseSchema>;

// === /capabilities ===

export const LiveCapabilityEntrySchema = z.object({
  identifier: z.string(),
  description: z.string().optional(),
  windows: z.array(z.string()),
  permissions: z.array(z.string()),
});
export type LiveCapabilityEntry = z.infer<typeof LiveCapabilityEntrySchema>;

export const CapabilitiesResponseSchema = z.object({
  declared: z.array(LiveCapabilityEntrySchema),
  windows: z.array(z.string()),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

// === /devtools ===

export const DevtoolsPlatformSchema = z.enum(['wkwebview', 'webview2', 'webkitgtk']);
export type DevtoolsPlatform = z.infer<typeof DevtoolsPlatformSchema>;

export const DevtoolsResponseSchema = z.object({
  platform: DevtoolsPlatformSchema,
  inspectable: z.boolean(),
  url: z.string().nullable().optional(),
  hint: z.string(),
});
export type DevtoolsResponse = z.infer<typeof DevtoolsResponseSchema>;

// === /health ===

export const HealthResponseSchema = z.object({
  uptime_ms: z.number().int(),
  webview_ready: z.boolean(),
  sidecars_alive: z.boolean(),
  sidecars: z.array(SidecarSummarySchema),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
