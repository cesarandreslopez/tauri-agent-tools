# Refactoring Complete

**Date:** 2026-03-19
**Branch:** `contextful/modular-typescript-refactoring/6k7kyr83`

## What Was Refactored

The monolithic `src/schemas.ts` (240 lines, 16 importers) was split into a `src/schemas/` module with 4 domain-focused files. The existing directory structure (bridge/, commands/, platform/, util/) was already cohesive and did not require reorganization.

**Why:** `schemas.ts` mixed unrelated Zod schema concerns (bridge protocol, DOM trees, CLI options, platform-specific parsing). This made it harder to understand which schemas belonged to which domain and created a single-file bottleneck for all schema changes.

## Final Module Structure

```
src/
├── cli.ts                  # Entry point — 15 commands via commander
├── types.ts                # Pure interfaces (WindowInfo, PlatformAdapter, etc.)
├── schemas/
│   ├── index.ts            # Barrel re-exports
│   ├── bridge.ts           # Bridge protocol (TokenFile, BridgeConfig, ElementRect, etc.)
│   ├── dom.ts              # Recursive DOM/a11y trees (DomNode, A11yNode)
│   ├── commands.ts         # CLI options/output (ImageFormat, StorageEntry, etc.)
│   └── platform.ts         # Platform-specific (WindowId, CGWindowInfo, SwayNode)
├── bridge/
│   ├── client.ts           # BridgeClient HTTP communication
│   └── tokenDiscovery.ts   # Token file scanning and PID liveness
├── commands/
│   ├── shared.ts           # addBridgeOptions(), resolveBridge()
│   └── [14 command files]  # One file per CLI command
├── platform/
│   ├── detect.ts           # detectDisplayServer(), ensureTools()
│   ├── x11.ts              # X11 adapter
│   ├── wayland.ts          # Wayland/Sway adapter
│   └── macos.ts            # macOS adapter
└── util/
    ├── exec.ts             # exec(), validateWindowId()
    └── image.ts            # cropImage(), resizeImage(), computeCropRect()
```

## Key Decisions

1. **D1: Dedicated `schemas/` module** — Schemas are cross-cutting (ElementRect used by bridge/ and util/; A11yNode by bridge/ and commands/). Co-locating would break the DAG or require duplication.

2. **D2: Four domain files, not per-consumer** — Many schemas have 1-2 consumers. Per-consumer files would create 10+ tiny files. Domain grouping (bridge, dom, commands, platform) keeps related schemas together in 40-85 line files.

3. **D3: `types.ts` keeps only pure interfaces** — Removed all re-exports. Consumers import schema types directly from `schemas/`.

4. **D6: Embedded JS template literals deferred** — Out of scope for this modularity refactoring. See validation.md recommendations.

## Metrics: Before vs After

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Source files | 26 | 30 | +4 (schema domain files + barrel) |
| Lines of code | 2,760 | 2,840 | +80 (file headers, barrel) |
| Largest file | 271 lines | 273 lines | +2 |
| Circular deps | 0 | 0 | -- |
| `any` usage | 0 | 0 | -- |
| Test files | 23 | 28 | +5 |
| Tests | 242 | 309 | +67 |
| Schema test coverage | 0 | 67 tests | New |
| Import DAG enforcement | None | `check-imports.mjs` | New |
| TS strictness flags | 5 | 8 | +3 |

## Infrastructure Added

- **`scripts/check-imports.mjs`** — Enforces the module dependency DAG. Prevents imports from flowing upward (e.g., schemas/ importing from commands/).
- **`specs/_templates/new-feature.md`** — Template for planning new features with dependency checks.

## Remaining Technical Debt / Future Work

1. **Embedded JS template literals** — 7 source files contain multi-line JavaScript template strings injected into the Tauri webview. Extracting into testable template files would improve maintainability. (Documented in D6)

2. **Explicit return types** — 7 exported functions lack explicit return type annotations. Low priority since TypeScript infers them correctly.

3. **`commands/dom.ts` complexity** — At 273 lines, it's the largest file. Mixes JS snippet generation with CLI logic. A future phase could extract snippets into a `snippets/` module.

## Phases

| Phase | Summary |
|-------|---------|
| 0: Discovery & Baseline | Analyzed codebase, captured baseline metrics |
| 1: Define Target Architecture | Designed module structure, dependency DAG, 6 architectural decisions |
| 2: Infrastructure & Safety Net | Created `check-imports.mjs`, established gate checks |
| 3: Extract Modules | Split `schemas.ts` → `schemas/`, updated all 16 consumers, added 45 schema tests |
| 4: Validate & Harden | Added 22 integration tests, comprehensive validation report |
| 5: Cleanup & Finalize | Enabled 3 new TS strictness flags, updated CLAUDE.md, archived specs, final verification |
