# Codebase Discovery — 2026-03-19

## Vital Statistics
- **Total TS/TSX files:** 26
- **Total lines of code:** 2,760
- **Framework(s):** Commander.js (CLI), Zod (validation)
- **Node version:** v24.13.1
- **TypeScript version:** 5.9.3
- **Strict mode:** Yes (`"strict": true`)
- **Module system:** ESM (`"type": "module"`, NodeNext resolution)
- **Bundler/build:** `tsc` (no bundler — compiles to `dist/`)
- **Entry point(s):** `src/cli.ts`
- **Test runner:** Vitest (globals mode)
- **Package version:** 0.4.0

## Current Structure
```
src/
├── cli.ts                  (72 lines)   Entry point — registers 14 commands
├── schemas.ts              (240 lines)  Zod schemas & derived types
├── types.ts                (28 lines)   Re-exports from schemas + interfaces
├── bridge/
│   ├── client.ts           (161 lines)  BridgeClient HTTP class
│   └── tokenDiscovery.ts   (89 lines)   Token file scanning
├── commands/
│   ├── consoleMonitor.ts   (156 lines)
│   ├── diff.ts             (109 lines)
│   ├── dom.ts              (271 lines)  *** LARGEST FILE ***
│   ├── eval.ts             (29 lines)
│   ├── info.ts             (34 lines)
│   ├── ipcMonitor.ts       (147 lines)
│   ├── listWindows.ts      (71 lines)
│   ├── mutations.ts        (168 lines)
│   ├── pageState.ts        (50 lines)
│   ├── rustLogs.ts         (120 lines)
│   ├── screenshot.ts       (106 lines)
│   ├── shared.ts           (36 lines)   addBridgeOptions + resolveBridge
│   ├── snapshot.ts         (150 lines)
│   ├── storage.ts          (130 lines)
│   └── wait.ts             (85 lines)
├── platform/
│   ├── detect.ts           (88 lines)   Display server detection
│   ├── macos.ts            (137 lines)  macOS adapter
│   ├── wayland.ts          (103 lines)  Wayland adapter
│   └── x11.ts              (88 lines)   X11 adapter
└── util/
    ├── exec.ts             (46 lines)   exec() + validateWindowId()
    └── image.ts            (46 lines)   Crop/resize via ImageMagick
```

## Problem Areas

| File | Lines | Why it's a problem |
|------|-------|--------------------|
| `commands/dom.ts` | 271 | Largest file. Mixes JS snippet generation (inline strings for DOM traversal + a11y tree), bridge communication, CLI registration, and output formatting. |
| `schemas.ts` | 240 | Mega-schema file. Contains 30+ Zod schemas/types for bridge responses, CLI options, platform data, storage, IPC, mutations — all unrelated concerns in one file. High fan-in (16 importers). |
| `commands/mutations.ts` | 168 | Embeds complex JS snippets as template literals for mutation observer setup. |
| `bridge/client.ts` | 161 | Embeds multi-line JS accessibility tree walker as a template literal string. |
| `commands/consoleMonitor.ts` | 156 | Embeds JS snippet for console interception. |
| `commands/snapshot.ts` | 150 | 6 imports (highest fan-out among commands). Composes dom + screenshot + storage — a mini-orchestrator. |
| `cli.ts` | 72 | 24 import lines. Fan-out of 20. Every command registration is explicit — but this is a natural hub, not a problem per se. |

## Dependency Hotspots

### Files with most importers (high fan-in):
| File | Importers |
|------|-----------|
| `schemas.ts` | 16 |
| `types.ts` | 15 |
| `commands/shared.ts` | 11 |
| `bridge/client.ts` | 5 |
| `util/exec.ts` | 5 |
| `commands/dom.ts` | 2 |
| `platform/detect.ts` | 2 |
| `bridge/tokenDiscovery.ts` | 2 |
| `util/image.ts` | 2 |

### Files with most imports (high fan-out):
| File | Imports |
|------|---------|
| `cli.ts` | 20 |
| `commands/snapshot.ts` | 6 |
| `commands/screenshot.ts` | 4 |
| `commands/consoleMonitor.ts` | 3 |
| `commands/ipcMonitor.ts` | 3 |
| `commands/mutations.ts` | 3 |
| `commands/rustLogs.ts` | 3 |
| `commands/shared.ts` | 3 |
| `platform/macos.ts` | 3 |
| `platform/wayland.ts` | 3 |

## Circular Dependencies

**None.** `npx madge --circular` reports zero cycles.

## Type Safety Gaps
- **Files with `any` usage:** 0
- **`@ts-ignore` / `@ts-expect-error` count:** 0
- **Missing return types on exported functions:** 7 functions across 5 files:
  - `src/commands/info.ts:5` — `registerInfo()`
  - `src/commands/snapshot.ts:38` — `registerSnapshot()`
  - `src/commands/wait.ts:9` — `registerWait()`
  - `src/commands/screenshot.ts:13` — `registerScreenshot()`
  - `src/commands/listWindows.ts:5` — `registerListWindows()`
  - `src/util/exec.ts:15` — `exec()`
  - `src/util/image.ts:33` — `computeCropRect()`

## Global / Singleton State

| Location | Variable | Type | Risk |
|----------|----------|------|------|
| `src/cli.ts:35` | `let checkedTools: DisplayServer \| null = null` | Module-level mutable | Low — caches platform detection result, only used in `getAdapter()`. No concurrency risk in CLI context. |
| `src/bridge/tokenDiscovery.ts:20` | `let files: string[]` | Function-local `let` | None — scoped inside `discoverBridge()` |
| `src/bridge/tokenDiscovery.ts:31` | `let found: BridgeConfig \| null` | Function-local `let` | None — scoped inside `discoverBridge()` |
| `src/bridge/tokenDiscovery.ts:60` | `let files: string[]` | Function-local `let` | None — scoped inside `cleanupStaleTokens()` |
| `src/platform/detect.ts:74` | `let checks: ToolCheck[]` | Function-local `let` | None — scoped inside `ensureTools()` |

**Note:** Several `var` declarations exist in `bridge/client.ts`, `commands/mutations.ts`, `commands/pageState.ts`, and `platform/macos.ts`, but these are inside **template literal JS strings** that get `eval()`-ed in the Tauri webview context — not actual TypeScript module-level state.

**True module-level mutable state:** Only `checkedTools` in `cli.ts`.

## Test Baseline
- **Can tests run?** Yes
- **Test command:** `npx vitest run`
- **Test runner:** Vitest (globals mode)
- **Passing:** 242 / 242
- **Failing:** 0
- **Test files:** 23
- **Duration:** 1.27s
- **No tests for:**
  - `src/types.ts` (re-export file — arguably doesn't need tests)
  - `src/schemas.ts` (240 lines of Zod schemas — should have validation tests)
  - `src/cli.ts` (entry point / command registration)
  - `src/util/exec.ts` (exec wrapper + validateWindowId)

## TypeScript Baseline
- **Typecheck command:** `npx -p typescript tsc --noEmit`
- **Errors:** 0

## Import Linter
- **No `scripts/check-imports.mjs` exists** — no DAG enforcement rules in place.

## Git Change Frequency (top files)
| Changes | File |
|---------|------|
| 10 | `src/cli.ts` |
| 6 | `src/types.ts` |
| 5 | `src/schemas.ts` |
| 5 | `src/commands/dom.ts` |
| 5 | `src/bridge/client.ts` |
| 4 | `src/platform/macos.ts` |
| 4 | `src/commands/storage.ts` |
| 4 | `src/bridge/tokenDiscovery.ts` |

## Key Observations for Refactoring

1. **The codebase is small (2,760 lines) and well-structured.** The existing module boundaries (bridge, commands, platform, util) are sensible. No file exceeds 271 lines.

2. **`schemas.ts` is the primary extraction target.** At 240 lines and 16 importers, it's a monolith schema file mixing bridge schemas, CLI option schemas, platform schemas, and domain types. Splitting by concern would reduce coupling.

3. **Embedded JS snippets are a secondary concern.** Several command files (`dom.ts`, `mutations.ts`, `consoleMonitor.ts`, `bridge/client.ts`) contain multi-line JavaScript template literals that are injected into the Tauri webview. These are hard to test and maintain inline.

4. **No circular dependencies** — the DAG is clean. `schemas.ts` is a leaf (0 imports), making it safe to split without introducing cycles.

5. **Type safety is excellent** — zero `any`, zero `@ts-ignore`, strict mode on. Only 7 exported functions lack explicit return types.

6. **Test coverage is strong** — 23 test files, 242 tests, all passing. Only 4 source files lack direct test coverage.
