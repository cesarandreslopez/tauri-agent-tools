/**
 * Shared Zod schemas and derived TypeScript types, organized by domain.
 * Foundation layer of the dependency DAG — no internal imports except `zod`.
 *
 * Barrel re-exports from all domain files. Consumers may import directly
 * from domain files (e.g., '../schemas/bridge.js') for explicitness.
 */

export {
  TokenFileSchema,
  type TokenFile,
  ElementRectSchema,
  type ElementRect,
  BridgeConfigSchema,
  type BridgeConfig,
  ViewportSizeSchema,
  type ViewportSize,
  RustLogLevelSchema,
  type RustLogLevel,
  RustLogEntrySchema,
  type RustLogEntry,
  BridgeEvalResponseSchema,
  BridgeLogsResponseSchema,
} from './bridge.js';

export {
  DomNodeSchema,
  type DomNode,
  A11yNodeSchema,
  type A11yNode,
} from './dom.js';

export {
  StorageEntrySchema,
  type StorageEntry,
  PageStateSchema,
  type PageState,
  ConsoleLevelSchema,
  type ConsoleLevel,
  ConsoleEntrySchema,
  type ConsoleEntry,
  MutationTypeSchema,
  type MutationType,
  MutationEntrySchema,
  type MutationEntry,
  IpcEntrySchema,
  type IpcEntry,
  SnapshotStorageResultSchema,
  type SnapshotStorageResult,
  ImageFormatSchema,
  type ImageFormat,
  StorageTypeSchema,
  type StorageType,
  DomModeSchema,
  type DomMode,
  PackageJsonSchema,
  type PackageJson,
} from './commands.js';

export {
  WindowIdSchema,
  CGWindowInfoSchema,
  type CGWindowInfo,
  SwayNodeSchema,
  type SwayNode,
} from './platform.js';

export {
  InteractionResultSchema,
  type InteractionResult,
  ClickResultSchema,
  type ClickResult,
  TypeResultSchema,
  type TypeResult,
  ScrollResultSchema,
  type ScrollResult,
  SelectResultSchema,
  type SelectResult,
  InvokeResultSchema,
  type InvokeResult,
} from './interact.js';
