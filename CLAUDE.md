# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**tauri-agent-tools** — A TypeScript CLI tool for agent-driven inspection of Tauri desktop applications. Captures real platform pixels of DOM elements by combining `getBoundingClientRect` positions with native screenshot tools (not canvas renders). All commands are read-only.

## Commands

```bash
npm run build        # Compile TypeScript → dist/
npm test             # Run vitest once
npm run test:watch   # Vitest in watch mode
npm run dev          # tsc --watch
```

Run a single test file:
```bash
npx vitest run tests/commands/screenshot.test.ts
```

## Key Source Locations

| Location | Purpose |
|----------|---------|
| `src/cli.ts` | Entry point — registers all 15 commands via `commander` |
| `src/types.ts` | Shared types: `WindowInfo`, `ElementRect`, `BridgeConfig`, `PlatformAdapter`, `DisplayServer`, `RustLogEntry` |
| `src/commands/` | One file per command (`screenshot.ts`, `dom.ts`, `eval.ts`, `wait.ts`, `info.ts`, `listWindows.ts`, `ipcMonitor.ts`, `consoleMonitor.ts`, `rustLogs.ts`, `storage.ts`, `pageState.ts`, `diff.ts`, `mutations.ts`, `snapshot.ts`) |
| `src/commands/shared.ts` | `addBridgeOptions()` and `resolveBridge()` — shared bridge option wiring |
| `src/platform/detect.ts` | `detectDisplayServer()` and `ensureTools()` — runtime platform detection |
| `src/platform/x11.ts` | X11 adapter: `xdotool` + ImageMagick `import` |
| `src/platform/wayland.ts` | Wayland/Sway adapter: `swaymsg` + `grim` |
| `src/platform/macos.ts` | macOS adapter: `screencapture` + `osascript` + `sips` |
| `src/bridge/client.ts` | `BridgeClient` class — HTTP POST to `/eval` and `/logs` endpoints |
| `src/bridge/tokenDiscovery.ts` | Token file scanning (`/tmp/tauri-dev-bridge-*.token`), PID liveness, stale cleanup |
| `src/util/image.ts` | `cropImage()`, `resizeImage()`, `computeCropRect()` — ImageMagick operations |
| `src/util/exec.ts` | `exec()` wrapper around `execFile()`, `validateWindowId()` |
| `examples/tauri-bridge/src/dev_bridge.rs` | Reference Rust bridge (~120 lines) — not part of build |

## Architecture

**Module system:** ESM (`"type": "module"`) with NodeNext resolution. All imports must use `.js` extensions (pointing to compiled output).

**Entry point:** `src/cli.ts` registers 15 commands via `commander`. Each command is in `src/commands/`.

**Command registration pattern:** Each command file exports a `registerXxx(program, ...)` function. Commands that need the platform adapter receive `getAdapter` as a parameter. Commands that need the bridge use `resolveBridge()` from `shared.ts`, which handles auto-discovery or explicit `--port`/`--token`.

**Bridge resolution flow:** `resolveBridge()` in `shared.ts` → `discoverBridge()` in `tokenDiscovery.ts` → scans `/tmp/tauri-dev-bridge-*.token` files → parses JSON (`{ port, token, pid }`) → checks PID liveness via `process.kill(pid, 0)` → cleans stale files from dead processes → returns first live bridge config. If both `--port` and `--token` are provided, auto-discovery is skipped.

**Platform adapter pattern:** `src/platform/` has three adapters (X11, Wayland, macOS) implementing a common interface (`findWindow`, `captureWindow`, `getWindowGeometry`, `getWindowName`, `listWindows`). Detection logic in `src/platform/detect.ts` selects the adapter at runtime.

**Bridge client:** `src/bridge/client.ts` communicates with a Rust dev bridge running inside the Tauri app via HTTP POST to a localhost `/eval` endpoint with token auth. Token auto-discovered from `/tmp/tauri-dev-bridge-*.token` files (see `src/bridge/tokenDiscovery.ts`).

**Crop computation:** Screenshot commands combine window geometry from the platform adapter with element rect from the bridge to compute crop regions, accounting for window decorations (title bar, borders).

**Rust bridge example:** `examples/tauri-bridge/src/dev_bridge.rs` (~120 lines) shows the Tauri-side HTTP server. Not part of the build — it's reference code for users integrating into their own Tauri apps.

## Key Constraints

- **Security:** Uses `execFile()` with array args everywhere — never `exec()` with shell strings. Window IDs validated with `/^\d+$/` before use.
- **No write operations:** No input injection, no state modification. This is a deliberate design choice, not a limitation.
- **Node >=20 required:** Uses native `fetch()` (no HTTP library dependency).
- **TypeScript strict mode** with declarations generated to `dist/`.
- **Tests use vitest globals:** `describe`, `it`, `expect` available without imports.

## Conventions

- **Import extensions:** Always use `.js` extensions in imports (ESM + NodeNext resolution).
- **Process execution:** Always use `execFile()` with array args (via `src/util/exec.ts`). Never use `exec()` with shell strings — prevents command injection.
- **Window ID validation:** All window IDs must match `/^\d+$/` before being passed to external tools. See `validateWindowId()` in `src/util/exec.ts`.
- **Vitest globals:** Tests use `describe`, `it`, `expect` without imports (configured in `vitest.config.ts`).
- **Commit messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **Branch naming:** `feature/<name>`, `fix/<name>`, `docs/<name>`, `refactor/<name>`.

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md` with new version section
3. Commit: `chore: release v<version>`
4. Tag: `git tag v<version>` on `main`
5. Publish: `npm publish`

## Refactoring Status

**Currently in Phase 2** of a modular refactoring. See `specs/refactor/` for plans and progress.

**Goal:** Split monolithic `src/schemas.ts` (240 lines, 16 importers) into `src/schemas/` with 4 domain-focused files. All other modules stay structurally unchanged — only import paths update.

### Code Map (Current → Target)

| Current | Target | Change |
|---------|--------|--------|
| `src/schemas.ts` | `src/schemas/index.ts` (barrel) | Split into 4 domain files |
| — | `src/schemas/bridge.ts` | Bridge protocol schemas |
| — | `src/schemas/dom.ts` | DOM/a11y tree schemas |
| — | `src/schemas/commands.ts` | CLI option/output schemas |
| — | `src/schemas/platform.ts` | Platform-specific schemas |
| `src/types.ts` | `src/types.ts` | Remove re-exports, keep interfaces |
| `src/bridge/*` | `src/bridge/*` | Update import paths |
| `src/commands/*` | `src/commands/*` | Update import paths |
| `src/platform/*` | `src/platform/*` | Update import paths |
| `src/util/*` | `src/util/*` | Update import paths |
| `src/cli.ts` | `src/cli.ts` | Update import paths |

### Refactoring Rules

- Every PR must be under ~300 lines changed (excluding tests)
- `npx tsc --noEmit` must pass after every commit
- `npm test` must pass after every commit
- `node scripts/check-imports.mjs` must pass (enforces dependency DAG)
- `npx madge --circular --extensions ts,tsx src/` must show no new cycles
- No new `any` types
- Use the compatibility re-export pattern from `specs/refactor/re-export-template.md` when moving symbols

### Safety Net Commands

```bash
npx tsc --noEmit                              # Type check
npm test                                      # All tests
node scripts/check-imports.mjs                # Import DAG linter
npx madge --circular --extensions ts,tsx src/  # Circular dependency check
```

## Agent Skills

`.agents/skills/` contains two Agent Skills (agentskills.io format) that teach AI agents how to use this tool and set up the Rust bridge. These are shipped in the npm package.
