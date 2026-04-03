import { z } from 'zod';

// === Storage ===

export const StorageEntrySchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
});
export type StorageEntry = z.infer<typeof StorageEntrySchema>;

// === Page State ===

export const PageStateSchema = z.object({
  url: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  scroll: z.object({ x: z.number(), y: z.number() }),
  document: z.object({ width: z.number(), height: z.number() }),
  hasTauri: z.boolean(),
});
export type PageState = z.infer<typeof PageStateSchema>;

// === Console Monitor ===

export const ConsoleLevelSchema = z.enum(['log', 'warn', 'error', 'info', 'debug']);
export type ConsoleLevel = z.infer<typeof ConsoleLevelSchema>;

export const ConsoleEntrySchema = z.object({
  level: ConsoleLevelSchema,
  message: z.string(),
  timestamp: z.number(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

// === Mutations ===

export const MutationTypeSchema = z.enum(['childList', 'attributes', 'characterData']);
export type MutationType = z.infer<typeof MutationTypeSchema>;

export const MutationEntrySchema = z.object({
  type: MutationTypeSchema,
  target: z.string(),
  timestamp: z.number(),
  added: z.array(z.object({
    tag: z.string(),
    id: z.string().optional(),
    class: z.string().optional(),
  })).optional(),
  removed: z.array(z.object({
    tag: z.string(),
    id: z.string().optional(),
    class: z.string().optional(),
  })).optional(),
  attribute: z.string().optional(),
  oldValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
});
export type MutationEntry = z.infer<typeof MutationEntrySchema>;

// === IPC Monitor ===

export const IpcEntrySchema = z.object({
  command: z.string(),
  args: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
  duration: z.number().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type IpcEntry = z.infer<typeof IpcEntrySchema>;

// === Snapshot: combined storage result ===

export const SnapshotStorageResultSchema = z.object({
  localStorage: z.array(StorageEntrySchema),
  sessionStorage: z.array(StorageEntrySchema),
});
export type SnapshotStorageResult = z.infer<typeof SnapshotStorageResultSchema>;

// === CLI Options ===

export const ImageFormatSchema = z.enum(['png', 'jpg']);
export type ImageFormat = z.infer<typeof ImageFormatSchema>;

export const StorageTypeSchema = z.enum(['local', 'session', 'cookies', 'all']);
export type StorageType = z.infer<typeof StorageTypeSchema>;

export const DomModeSchema = z.enum(['dom', 'accessibility']);
export type DomMode = z.infer<typeof DomModeSchema>;

// === Capture manifest ===

export const CaptureManifestSchema = z.object({
  timestamp: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  errorCount: z.number().optional(),
  files: z.record(z.string(), z.string()),
});
export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;

// === CLI: package.json ===

export const PackageJsonSchema = z.object({
  version: z.string(),
}).passthrough();
export type PackageJson = z.infer<typeof PackageJsonSchema>;

// === Store Inspect ===

export const StoreInspectResultSchema = z.object({
  framework: z.string(),
  stores: z.record(z.string(), z.unknown()),
});
export type StoreInspectResult = z.infer<typeof StoreInspectResultSchema>;

// === Check ===

export const CheckItemSchema = z.object({
  type: z.enum(['selector', 'text', 'eval', 'no-errors']),
  passed: z.boolean(),
  selector: z.string().optional(),
  pattern: z.string().optional(),
  expression: z.string().optional(),
  errors: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type CheckItem = z.infer<typeof CheckItemSchema>;

export const CheckResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(CheckItemSchema),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;
