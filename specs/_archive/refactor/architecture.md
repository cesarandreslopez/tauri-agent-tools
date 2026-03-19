# Target Architecture

## Overview

The codebase is 26 files / 2,760 lines with a clean existing structure. The primary refactoring target is `schemas.ts` (240 lines, 16 importers) which mixes unrelated Zod schema concerns. The existing directory boundaries (bridge/, commands/, platform/, util/) are already cohesive and do not need reorganization.

**Key change:** Split monolithic `schemas.ts` into a new `schemas/` module with domain-focused files. All other modules remain structurally unchanged but update their import paths.

## Modules

### 1. schemas/ (NEW — replaces schemas.ts)

- **Purpose:** Shared Zod schemas and derived TypeScript types, organized by domain.
- **Dependencies:** `zod` (external only — leaf node in the DAG)
- **Current files:** `src/schemas.ts` (to be deleted)
- **Target files:** `src/schemas/index.ts`, `src/schemas/bridge.ts`, `src/schemas/dom.ts`, `src/schemas/commands.ts`, `src/schemas/platform.ts`
- **Public API:** All schemas and types re-exported via `schemas/index.ts`

### 2. bridge/

- **Purpose:** HTTP communication with the Tauri dev bridge (eval endpoint, log endpoint, token discovery).
- **Dependencies:** `schemas/`, `types.ts`
- **Current files:** `src/bridge/client.ts`, `src/bridge/tokenDiscovery.ts`
- **Target files:** Same (import paths updated)
- **Public API:** `BridgeClient`, `discoverBridge()`, `discoverBridgesByPid()`

### 3. commands/

- **Purpose:** CLI command registration and execution. One file per command, each exporting a `registerXxx()` function.
- **Dependencies:** `schemas/`, `types.ts`, `bridge/`, `util/`, `platform/` (info command only)
- **Current files:** 14 command files + `shared.ts`
- **Target files:** Same (import paths updated)
- **Public API:** `registerXxx()` functions, `addBridgeOptions()`, `resolveBridge()`, `buildSerializerScript()`

### 4. platform/

- **Purpose:** Platform-specific window operations (find, capture, geometry, list). Three adapters (X11, Wayland, macOS) behind a common `PlatformAdapter` interface.
- **Dependencies:** `schemas/`, `types.ts`, `util/`
- **Current files:** `src/platform/detect.ts`, `src/platform/x11.ts`, `src/platform/wayland.ts`, `src/platform/macos.ts`
- **Target files:** Same (import paths updated)
- **Public API:** `detectDisplayServer()`, `ensureTools()`, `X11Adapter`, `WaylandAdapter`, `MacOSAdapter`

### 5. util/

- **Purpose:** Shared utilities for process execution and image manipulation.
- **Dependencies:** `schemas/`, `types.ts`
- **Current files:** `src/util/exec.ts`, `src/util/image.ts`
- **Target files:** Same (import paths updated)
- **Public API:** `exec()`, `validateWindowId()`, `cropImage()`, `resizeImage()`, `computeCropRect()`

### Root files

- **cli.ts** — Entry point. Registers commands, creates platform adapter. Dependencies: commands/, platform/, bridge/, schemas/, types.ts.
- **types.ts** — Pure interfaces (`WindowInfo`, `PlatformAdapter`, `DisplayServer`, `WindowListEntry`). After migration, re-exports from schemas.ts are removed; consumers import schema types directly from `schemas/`.

## Dependency DAG

```
Level 0 (entry):  cli.ts
                   |
Level 1 (cmds):   commands/
                   |  \
Level 2 (infra):  bridge/  platform/
                   |       |
Level 3 (util):   util/
                   |
Level 4 (types):  schemas/  types.ts
                  (leaf)    (imports schemas/)
```

### Allowed dependency matrix

| Module       | May import from                                         |
|--------------|---------------------------------------------------------|
| `cli.ts`     | `commands/`, `platform/`, `bridge/`, `schemas/`, `types.ts` |
| `commands/`  | `bridge/`, `platform/`, `util/`, `schemas/`, `types.ts` |
| `platform/`  | `util/`, `schemas/`, `types.ts`                          |
| `bridge/`    | `schemas/`, `types.ts`                                   |
| `util/`      | `schemas/`, `types.ts`                                   |
| `types.ts`   | `schemas/`                                               |
| `schemas/`   | _(none — only external `zod`)_                           |

### Forbidden directions (no arrows may point upward)

- `schemas/` must NOT import from any other module
- `types.ts` must NOT import from bridge/, commands/, platform/, util/
- `util/` must NOT import from bridge/, commands/, platform/
- `bridge/` must NOT import from commands/, platform/, util/
- `platform/` must NOT import from commands/, bridge/
- `commands/` must NOT import from cli.ts

### ASCII DAG

```
cli.ts ──────────────────────────────┐
  │                                  │
  ├──→ commands/ ──┬──→ bridge/ ─────┤
  │                │                 │
  ├──→ platform/ ──┤                 │
  │                │                 │
  │                └──→ util/ ───────┤
  │                                  │
  └──────────────────────→ schemas/ ◄┘
                           types.ts ◄── schemas/
```

## Decisions

### D1: Split schemas.ts into schemas/ directory (not co-located per module)

**Considered:** Co-locating schemas inside each owning module (e.g., `bridge/schemas.ts`, `platform/schemas.ts`).

**Rejected because:** Several schemas are cross-cutting (ElementRect used by bridge/ and util/; A11yNode used by bridge/ and commands/; ImageFormat used by commands/ and types.ts). Co-locating would require either cross-module imports that break the DAG or duplicate definitions.

**Decision:** Create a dedicated `schemas/` module at the foundation layer. This preserves the current property that schemas are a leaf node with zero internal dependencies.

### D2: Keep schemas/ as 4 domain files (not per-consumer)

**Considered:** One schema file per consumer (e.g., `schemas/consoleMonitor.ts`, `schemas/ipcMonitor.ts`).

**Rejected because:** Many schemas have 1-2 consumers. Per-consumer files would create 10+ tiny files (3-10 lines each) with no cohesion benefit. Grouping by domain (bridge, dom, commands, platform) keeps related schemas together and produces files of 40-85 lines.

### D3: types.ts keeps only pure interfaces

**Decision:** After migration, `types.ts` contains only TypeScript interfaces and type aliases that don't use Zod: `WindowInfo`, `PlatformAdapter`, `DisplayServer`, `WindowListEntry`. The current re-exports (`ElementRect`, `BridgeConfig`, `RustLogEntry`, `ImageFormat`) are removed; consumers import directly from `schemas/`.

**Rationale:** Eliminates indirection. Makes dependencies explicit. Prevents types.ts from becoming a grab-bag re-export hub.

**Migration note:** types.ts will import `ImageFormat` from `schemas/commands.ts` (needed in `PlatformAdapter` interface) and `BridgeConfig` from `schemas/bridge.ts` (needed in `WindowListEntry` interface). These are type-only imports, not re-exports.

### D4: commands/ → platform/ dependency is allowed

**Observation:** `commands/info.ts` imports `detectDisplayServer` from `platform/detect.ts`. This is the only cross-level import between Level 1 and Level 2 modules.

**Decision:** Allow this. There is no reverse dependency (platform/ never imports from commands/), so no cycle risk. The info command legitimately needs platform detection to display window info.

### D5: No sub-domain splitting of commands/

**Considered:** Splitting commands/ into sub-groups (e.g., commands/monitoring/, commands/inspection/).

**Rejected because:** With 14 command files averaging 100 lines each, the flat structure is navigable. Each file is self-contained with a consistent pattern. Sub-directories would add nesting without reducing coupling.

### D6: Embedded JS template literals are out of scope

**Observation:** 7 source files contain multi-line JavaScript template literals injected into the Tauri webview via bridge.eval(). These are a maintainability concern (hard to test, no syntax highlighting).

**Decision:** Defer JS snippet extraction to a future phase. The current architecture change (schema split) is orthogonal. Extracting snippets would be a separate refactoring concern focused on testability, not modularity.

## schemas/ Internal Structure

### schemas/bridge.ts (~55 lines)

Schemas for the bridge HTTP protocol and data structures flowing through it.

| Schema | Type | Consumers |
|--------|------|-----------|
| `TokenFileSchema` | `TokenFile` | bridge/tokenDiscovery.ts |
| `BridgeConfigSchema` | `BridgeConfig` | bridge/client.ts, bridge/tokenDiscovery.ts, commands/shared.ts, types.ts |
| `ElementRectSchema` | `ElementRect` | bridge/client.ts, util/image.ts |
| `ViewportSizeSchema` | `ViewportSize` | bridge/client.ts |
| `RustLogLevelSchema` | `RustLogLevel` | commands/rustLogs.ts |
| `RustLogEntrySchema` | `RustLogEntry` | bridge/client.ts, commands/rustLogs.ts |
| `BridgeEvalResponseSchema` | _(no type)_ | bridge/client.ts |
| `BridgeLogsResponseSchema` | _(no type)_ | bridge/client.ts |

### schemas/dom.ts (~45 lines)

Recursive tree schemas for DOM and accessibility tree structures.

| Schema | Type | Consumers |
|--------|------|-----------|
| `DomNodeSchema` | `DomNode` | commands/dom.ts, commands/snapshot.ts |
| `A11yNodeSchema` | `A11yNode` | bridge/client.ts, commands/dom.ts |

### schemas/commands.ts (~85 lines)

Schemas for CLI command options and command-specific output types.

| Schema | Type | Consumers |
|--------|------|-----------|
| `ImageFormatSchema` | `ImageFormat` | commands/screenshot.ts, commands/snapshot.ts, types.ts |
| `DomModeSchema` | `DomMode` | commands/dom.ts |
| `StorageTypeSchema` | `StorageType` | commands/storage.ts |
| `StorageEntrySchema` | `StorageEntry` | commands/storage.ts, commands/snapshot.ts |
| `SnapshotStorageResultSchema` | `SnapshotStorageResult` | commands/snapshot.ts |
| `PageStateSchema` | `PageState` | commands/pageState.ts, commands/snapshot.ts |
| `ConsoleLevelSchema` | `ConsoleLevel` | commands/consoleMonitor.ts |
| `ConsoleEntrySchema` | `ConsoleEntry` | commands/consoleMonitor.ts |
| `MutationTypeSchema` | `MutationType` | commands/mutations.ts |
| `MutationEntrySchema` | `MutationEntry` | commands/mutations.ts |
| `IpcEntrySchema` | `IpcEntry` | commands/ipcMonitor.ts |
| `PackageJsonSchema` | `PackageJson` | cli.ts |

### schemas/platform.ts (~50 lines)

Schemas for platform-specific data parsing and validation.

| Schema | Type | Consumers |
|--------|------|-----------|
| `WindowIdSchema` | _(no type)_ | util/exec.ts |
| `CGWindowInfoSchema` | `CGWindowInfo` | platform/macos.ts |
| `SwayNodeSchema` | `SwayNode` | platform/wayland.ts |

### schemas/index.ts (~20 lines)

Barrel re-export of all schemas and types from the four domain files. Provides a single import point during migration; consumers may later import directly from domain files.

## Complete File Mapping

Every file in `src/` mapped to exactly one target module.

| Current Path | Target Path | Module | Notes |
|---|---|---|---|
| `src/schemas.ts` | _(deleted)_ | — | Split into schemas/*.ts |
| _(new)_ | `src/schemas/index.ts` | schemas | Barrel re-exports |
| _(new)_ | `src/schemas/bridge.ts` | schemas | Bridge protocol schemas |
| _(new)_ | `src/schemas/dom.ts` | schemas | DOM tree schemas |
| _(new)_ | `src/schemas/commands.ts` | schemas | Command option/output schemas |
| _(new)_ | `src/schemas/platform.ts` | schemas | Platform-specific schemas |
| `src/types.ts` | `src/types.ts` | root | Remove re-exports, keep interfaces |
| `src/cli.ts` | `src/cli.ts` | root | Update import paths |
| `src/bridge/client.ts` | `src/bridge/client.ts` | bridge | Update: `../schemas.js` → `../schemas/bridge.js`, `../schemas/dom.js` |
| `src/bridge/tokenDiscovery.ts` | `src/bridge/tokenDiscovery.ts` | bridge | Update: `../schemas.js` → `../schemas/bridge.js` |
| `src/commands/shared.ts` | `src/commands/shared.ts` | commands | No schema import changes needed |
| `src/commands/dom.ts` | `src/commands/dom.ts` | commands | Update: `../schemas.js` → `../schemas/dom.js`, `../schemas/commands.js` |
| `src/commands/eval.ts` | `src/commands/eval.ts` | commands | No schema imports |
| `src/commands/screenshot.ts` | `src/commands/screenshot.ts` | commands | Update: `../schemas.js` → `../schemas/commands.js` |
| `src/commands/snapshot.ts` | `src/commands/snapshot.ts` | commands | Update: `../schemas.js` → `../schemas/dom.js`, `../schemas/commands.js` |
| `src/commands/consoleMonitor.ts` | `src/commands/consoleMonitor.ts` | commands | Update: `../schemas.js` → `../schemas/commands.js` |
| `src/commands/ipcMonitor.ts` | `src/commands/ipcMonitor.ts` | commands | Update: `../schemas.js` → `../schemas/commands.js` |
| `src/commands/mutations.ts` | `src/commands/mutations.ts` | commands | Update: `../schemas.js` → `../schemas/commands.js` |
| `src/commands/pageState.ts` | `src/commands/pageState.ts` | commands | Update: `../schemas.js` → `../schemas/commands.js` |
| `src/commands/storage.ts` | `src/commands/storage.ts` | commands | Update: `../schemas.js` → `../schemas/commands.js` |
| `src/commands/rustLogs.ts` | `src/commands/rustLogs.ts` | commands | Update: `../schemas.js` → `../schemas/bridge.js` |
| `src/commands/wait.ts` | `src/commands/wait.ts` | commands | No schema imports |
| `src/commands/info.ts` | `src/commands/info.ts` | commands | No schema imports |
| `src/commands/listWindows.ts` | `src/commands/listWindows.ts` | commands | No schema imports |
| `src/commands/diff.ts` | `src/commands/diff.ts` | commands | No schema imports |
| `src/platform/detect.ts` | `src/platform/detect.ts` | platform | No schema imports |
| `src/platform/x11.ts` | `src/platform/x11.ts` | platform | No schema imports |
| `src/platform/wayland.ts` | `src/platform/wayland.ts` | platform | Update: `../schemas.js` → `../schemas/platform.js` |
| `src/platform/macos.ts` | `src/platform/macos.ts` | platform | Update: `../schemas.js` → `../schemas/platform.js` |
| `src/util/exec.ts` | `src/util/exec.ts` | util | Update: `../schemas.js` → `../schemas/platform.js` |
| `src/util/image.ts` | `src/util/image.ts` | util | No schema imports (uses types.ts) |

**Total:** 26 current files → 4 deleted/replaced + 5 new schema files + 22 updated-in-place = 27 target files.

## Global State Migration Plan

| Global | Current Location | Strategy |
|--------|------------------|----------|
| `checkedTools` | `src/cli.ts:35` — `let checkedTools: DisplayServer \| null = null` | **Keep as-is.** Module-level mutable cache for platform tool detection. Only used in `getAdapter()` within cli.ts. No concurrency risk in CLI context. Not shared across modules. No migration needed. |

**Note:** All other `let` declarations identified in Phase 0 are function-local (scoped inside `discoverBridge()`, `cleanupStaleTokens()`, `ensureTools()`). No migration needed.

## Circular Dependency Resolution Plan

| Cycle | Strategy |
|-------|----------|
| _(none)_ | No circular dependencies exist (confirmed by `npx madge --circular` in Phase 0). The target architecture preserves this property — all dependencies flow strictly downward in the DAG. |

**Preventive measure:** The import DAG rules (see below) explicitly forbid upward imports. Any future violation will be caught by `scripts/check-imports.mjs` (to be created in a later phase).

## Import DAG Rules (for scripts/check-imports.mjs)

`scripts/check-imports.mjs` does not yet exist. When created, it should enforce these rules:

```javascript
// Allowed imports for each module (directory-level)
const ALLOWED_DEPS = {
  'schemas/':   [],                                              // leaf — only zod
  'types.ts':   ['schemas/'],                                    // for ImageFormat, BridgeConfig types
  'util/':      ['schemas/', 'types.ts'],
  'bridge/':    ['schemas/', 'types.ts'],
  'platform/':  ['util/', 'schemas/', 'types.ts'],
  'commands/':  ['bridge/', 'platform/', 'util/', 'schemas/', 'types.ts'],
  'cli.ts':     ['commands/', 'platform/', 'bridge/', 'schemas/', 'types.ts'],
};

// Within commands/, allow intra-module imports (e.g., snapshot.ts → dom.ts)
// Within schemas/, allow intra-module imports (if needed for cross-references)
```

**Changes from current state:**
- Replace `'schemas.ts'` with `'schemas/'` in all allowed deps
- Add the `schemas/` entry as a leaf node
- No structural DAG changes — the allowed directions remain the same

## Migration Order

The schema split should be executed in this order to keep main green at every step:

1. **Create `schemas/` directory** with the 4 domain files + index.ts, copying schemas from `schemas.ts`
2. **Update `schemas/index.ts`** to re-export everything (backward-compatible barrel)
3. **Update consumers one module at a time** to import from `schemas/*.js` instead of `../schemas.js`:
   - util/ (2 files)
   - bridge/ (2 files)
   - platform/ (4 files)
   - commands/ (14 files)
   - cli.ts, types.ts
4. **Delete `src/schemas.ts`** once all consumers are migrated
5. **Update types.ts** to remove re-exports and keep only its own interfaces
6. **Update consumers of types.ts** to import schema types directly from `schemas/`
7. **Create `scripts/check-imports.mjs`** to enforce the DAG

Each step should compile (`npx tsc --noEmit`) and pass tests (`npm test`) before proceeding.
