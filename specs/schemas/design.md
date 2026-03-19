# schemas/ — Design Spec

## Purpose

Shared Zod schemas and derived TypeScript types, organized by domain. Foundation layer of the dependency DAG — no internal imports except `zod`.

## Public Interface

Exports via `schemas/index.ts` (barrel):

### From schemas/bridge.ts
- `TokenFileSchema`, `TokenFile`
- `BridgeConfigSchema`, `BridgeConfig`
- `ElementRectSchema`, `ElementRect`
- `ViewportSizeSchema`, `ViewportSize`
- `RustLogLevelSchema`, `RustLogLevel`
- `RustLogEntrySchema`, `RustLogEntry`
- `BridgeEvalResponseSchema`
- `BridgeLogsResponseSchema`

### From schemas/dom.ts
- `DomNodeSchema`, `DomNode` (interface + schema)
- `A11yNodeSchema`, `A11yNode` (interface + schema)

### From schemas/commands.ts
- `ImageFormatSchema`, `ImageFormat`
- `DomModeSchema`, `DomMode`
- `StorageTypeSchema`, `StorageType`
- `StorageEntrySchema`, `StorageEntry`
- `SnapshotStorageResultSchema`, `SnapshotStorageResult`
- `PageStateSchema`, `PageState`
- `ConsoleLevelSchema`, `ConsoleLevel`
- `ConsoleEntrySchema`, `ConsoleEntry`
- `MutationTypeSchema`, `MutationType`
- `MutationEntrySchema`, `MutationEntry`
- `IpcEntrySchema`, `IpcEntry`
- `PackageJsonSchema`, `PackageJson`

### From schemas/platform.ts
- `WindowIdSchema`
- `CGWindowInfoSchema`, `CGWindowInfo`
- `SwayNodeSchema`, `SwayNode` (interface + schema)

## Internal Structure

```
src/schemas/
├── index.ts        # Barrel re-exports from all domain files
├── bridge.ts       # Bridge protocol and data schemas (~55 lines)
├── dom.ts          # Recursive DOM/a11y tree schemas (~45 lines)
├── commands.ts     # CLI option and command output schemas (~85 lines)
└── platform.ts     # Platform-specific parsing schemas (~50 lines)
```

## Dependencies

- **Allowed imports:** `zod` (external)
- **Forbidden imports:** Any internal module (`bridge/`, `commands/`, `platform/`, `util/`, `types.ts`)

## Files to Move

| Source (current) | Destination (target) | Notes |
|---|---|---|
| `src/schemas.ts` lines 1-10 (TokenFile) | `src/schemas/bridge.ts` | |
| `src/schemas.ts` lines 14-26 (ElementRect, BridgeConfig) | `src/schemas/bridge.ts` | |
| `src/schemas.ts` lines 28-44 (ViewportSize, RustLogLevel, RustLogEntry) | `src/schemas/bridge.ts` | |
| `src/schemas.ts` lines 182-195 (BridgeEvalResponse, BridgeLogsResponse, PackageJson) | `src/schemas/bridge.ts` (responses), `src/schemas/commands.ts` (PackageJson) | |
| `src/schemas.ts` lines 48-86 (DomNode, A11yNode) | `src/schemas/dom.ts` | Recursive schemas use getter-based recursion |
| `src/schemas.ts` lines 90-106 (StorageEntry, PageState) | `src/schemas/commands.ts` | |
| `src/schemas.ts` lines 110-155 (ConsoleEntry, MutationEntry, IpcEntry) | `src/schemas/commands.ts` | |
| `src/schemas.ts` lines 157-174 (SnapshotStorageResult, ImageFormat, StorageType, DomMode) | `src/schemas/commands.ts` | |
| `src/schemas.ts` lines 178 (WindowId) | `src/schemas/platform.ts` | |
| `src/schemas.ts` lines 199-240 (CGWindowInfo, SwayNode) | `src/schemas/platform.ts` | Recursive schema (SwayNode) uses getter-based recursion |

## Open Questions

- **Barrel granularity:** Should consumers import from `schemas/index.ts` or directly from domain files (e.g., `schemas/bridge.ts`)? Target: direct imports for explicitness; barrel exists for migration convenience.
- **commands.ts naming:** This file contains both CLI option schemas (ImageFormat, DomMode) and command output schemas (ConsoleEntry, PageState). If it grows, consider splitting into `schemas/options.ts` and `schemas/output.ts`. At ~85 lines this is not yet needed.
