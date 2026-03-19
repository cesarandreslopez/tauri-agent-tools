# commands/ — Design Spec

## Purpose

CLI command registration and execution. Each file registers one command with Commander.js, following the `registerXxx(program, ...)` pattern.

## Public Interface

Each command file exports a `registerXxx()` function:

| Export | File | Parameters |
|--------|------|------------|
| `registerScreenshot` | screenshot.ts | `(program, getAdapter)` |
| `registerInfo` | info.ts | `(program, getAdapter)` |
| `registerDom` | dom.ts | `(program)` |
| `registerEval` | eval.ts | `(program)` |
| `registerWait` | wait.ts | `(program, getAdapter)` |
| `registerListWindows` | listWindows.ts | `(program, getAdapter)` |
| `registerIpcMonitor` | ipcMonitor.ts | `(program)` |
| `registerPageState` | pageState.ts | `(program)` |
| `registerStorage` | storage.ts | `(program)` |
| `registerConsoleMonitor` | consoleMonitor.ts | `(program)` |
| `registerMutations` | mutations.ts | `(program)` |
| `registerSnapshot` | snapshot.ts | `(program, getAdapter)` |
| `registerDiff` | diff.ts | `(program)` |
| `registerRustLogs` | rustLogs.ts | `(program)` |

Shared utilities from `shared.ts`:
- `addBridgeOptions(cmd: Command): Command`
- `resolveBridge(opts): Promise<BridgeClient>`

Additional export from `dom.ts`:
- `buildSerializerScript(selector, depth, includeStyles): string` (used by snapshot.ts)

Additional exports from `mutations.ts`:
- `formatEntry(entry: MutationEntry): string` (exported for tests)

## Internal Structure

```
src/commands/
├── shared.ts           # Bridge option wiring (36 lines)
├── dom.ts              # DOM query + a11y tree (271 lines)
├── eval.ts             # JS eval (29 lines)
├── screenshot.ts       # Screenshot capture (106 lines)
├── snapshot.ts         # Combined snapshot orchestrator (150 lines)
├── consoleMonitor.ts   # Console log monitoring (156 lines)
├── ipcMonitor.ts       # IPC call monitoring (147 lines)
├── mutations.ts        # DOM mutation watching (168 lines)
├── pageState.ts        # Page state query (50 lines)
├── storage.ts          # Storage inspection (130 lines)
├── rustLogs.ts         # Rust log monitoring (120 lines)
├── wait.ts             # Condition waiting (85 lines)
├── info.ts             # Window info (34 lines)
├── listWindows.ts      # Window listing (71 lines)
└── diff.ts             # Image diff (109 lines)
```

## Dependencies

- **Allowed imports:** `bridge/`, `platform/`, `util/`, `schemas/`, `types.ts`, intra-module (`commands/shared.ts`, `commands/dom.ts`)
- **Forbidden imports:** `cli.ts`

### Intra-module imports

- `snapshot.ts` → `dom.ts` (for `buildSerializerScript`)
- 11 command files → `shared.ts` (for `addBridgeOptions`, `resolveBridge`)

### Schema imports after migration

| File | Schemas needed | Target import path |
|---|---|---|
| dom.ts | DomNodeSchema, A11yNodeSchema, DomModeSchema | `../schemas/dom.js`, `../schemas/commands.js` |
| snapshot.ts | DomNodeSchema, PageStateSchema, SnapshotStorageResultSchema | `../schemas/dom.js`, `../schemas/commands.js` |
| screenshot.ts | ImageFormatSchema | `../schemas/commands.js` |
| consoleMonitor.ts | ConsoleEntrySchema, ConsoleLevelSchema | `../schemas/commands.js` |
| ipcMonitor.ts | IpcEntrySchema | `../schemas/commands.js` |
| mutations.ts | MutationEntrySchema | `../schemas/commands.js` |
| pageState.ts | PageStateSchema | `../schemas/commands.js` |
| storage.ts | StorageEntrySchema, StorageTypeSchema | `../schemas/commands.js` |
| rustLogs.ts | RustLogLevelSchema | `../schemas/bridge.js` |

## Files to Move

| Source (current) | Destination (target) | Notes |
|---|---|---|
| All 15 files in `src/commands/` | Same paths | Update import paths only |

## Open Questions

- **Embedded JS templates:** 7 command files contain multi-line JavaScript template literals for bridge eval. Future phase may extract these to testable modules.
- **snapshot.ts cross-command dependency:** snapshot.ts imports `buildSerializerScript` from dom.ts, making it a mini-orchestrator. This is acceptable as an intra-module dependency but could be extracted to shared.ts if more commands need it.
