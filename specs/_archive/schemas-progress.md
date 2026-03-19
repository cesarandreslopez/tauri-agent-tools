# schemas/ Extraction — Progress Tracker

## Status: DONE

## Migration Table

| What | From | To | Status |
|------|------|----|--------|
| TokenFileSchema, TokenFile | schemas.ts:5-10 | schemas/bridge.ts | Done |
| ElementRectSchema, ElementRect | schemas.ts:14-20 | schemas/bridge.ts | Done |
| BridgeConfigSchema, BridgeConfig | schemas.ts:22-26 | schemas/bridge.ts | Done |
| ViewportSizeSchema, ViewportSize | schemas.ts:28-32 | schemas/bridge.ts | Done |
| RustLogLevelSchema, RustLogLevel | schemas.ts:34-35 | schemas/bridge.ts | Done |
| RustLogEntrySchema, RustLogEntry | schemas.ts:37-44 | schemas/bridge.ts | Done |
| BridgeEvalResponseSchema | schemas.ts:182-184 | schemas/bridge.ts | Done |
| BridgeLogsResponseSchema | schemas.ts:186-188 | schemas/bridge.ts | Done |
| DomNode, DomNodeSchema | schemas.ts:48-70 | schemas/dom.ts | Done |
| A11yNode, A11yNodeSchema | schemas.ts:72-86 | schemas/dom.ts | Done |
| StorageEntrySchema, StorageEntry | schemas.ts:90-94 | schemas/commands.ts | Done |
| PageStateSchema, PageState | schemas.ts:98-106 | schemas/commands.ts | Done |
| ConsoleLevelSchema, ConsoleLevel | schemas.ts:110-111 | schemas/commands.ts | Done |
| ConsoleEntrySchema, ConsoleEntry | schemas.ts:113-118 | schemas/commands.ts | Done |
| MutationTypeSchema, MutationType | schemas.ts:122-123 | schemas/commands.ts | Done |
| MutationEntrySchema, MutationEntry | schemas.ts:125-143 | schemas/commands.ts | Done |
| IpcEntrySchema, IpcEntry | schemas.ts:147-155 | schemas/commands.ts | Done |
| SnapshotStorageResultSchema, SnapshotStorageResult | schemas.ts:159-163 | schemas/commands.ts | Done |
| ImageFormatSchema, ImageFormat | schemas.ts:167-168 | schemas/commands.ts | Done |
| StorageTypeSchema, StorageType | schemas.ts:170-171 | schemas/commands.ts | Done |
| DomModeSchema, DomMode | schemas.ts:173-174 | schemas/commands.ts | Done |
| PackageJsonSchema, PackageJson | schemas.ts:192-195 | schemas/commands.ts | Done |
| WindowIdSchema | schemas.ts:178 | schemas/platform.ts | Done |
| CGWindowInfoSchema, CGWindowInfo | schemas.ts:199-211 | schemas/platform.ts | Done |
| SwayNode, SwayNodeSchema | schemas.ts:215-240 | schemas/platform.ts | Done |

## Post-Extraction Checklist

- [x] index.ts exports match design.md
- [x] Re-export shim created then removed (all consumers migrated)
- [x] All consumers updated to import from schemas/ domain files
- [x] types.ts re-exports removed; only pure interfaces remain
- [x] tsc --noEmit passes
- [x] Unit tests pass (287 tests, 27 files)
- [x] Import linter passes (schemas.ts legacy entries removed)
- [x] No new circular deps (30 files, 0 cycles)
- [x] Full test suite passes

## Notes & Decisions

- schemas.ts was deleted entirely (not kept as empty file)
- types.ts now uses `import type` from schemas/ for ImageFormat and BridgeConfig
  (needed in PlatformAdapter and WindowListEntry interfaces) but does not re-export them
- check-imports.mjs cleaned up to remove legacy schemas.ts entries
- 45 new schema validation tests added (previously 0 coverage for schemas)
