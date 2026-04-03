# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**tauri-agent-tools** — A TypeScript CLI tool for agent-driven inspection and interaction with Tauri desktop applications. Captures real platform pixels of DOM elements by combining `getBoundingClientRect` positions with native screenshot tools (not canvas renders). Inspection commands are read-only. Interaction commands (click, type, scroll, etc.) are debug-only.

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
| `src/cli.ts` | Entry point — registers all 25 commands via `commander` |
| `src/schemas/` | Zod schemas split by domain: `bridge.ts`, `dom.ts`, `commands.ts`, `platform.ts`, `interact.ts` |
| `src/types.ts` | Pure interfaces: `WindowInfo`, `PlatformAdapter`, `DisplayServer`, `WindowListEntry` |
| `src/commands/` | One file per command (`screenshot.ts`, `dom.ts`, `eval.ts`, `wait.ts`, `info.ts`, `listWindows.ts`, `ipcMonitor.ts`, `consoleMonitor.ts`, `rustLogs.ts`, `storage.ts`, `pageState.ts`, `diff.ts`, `mutations.ts`, `snapshot.ts`, `check.ts`, `capture.ts`, `probe.ts`, `invoke.ts`, `storeInspect.ts`) |
| `src/commands/interact/` | Interaction commands: `click.ts`, `type.ts`, `scroll.ts`, `focus.ts`, `navigate.ts`, `select.ts`, `shared.ts` |
| `src/commands/shared.ts` | `addBridgeOptions()` and `resolveBridge()` — shared bridge option wiring |
| `src/platform/detect.ts` | `detectDisplayServer()` and `ensureTools()` — runtime platform detection |
| `src/platform/x11.ts` | X11 adapter: `xdotool` + ImageMagick `import` |
| `src/platform/wayland.ts` | Wayland/Sway adapter: `swaymsg` + `grim` |
| `src/platform/hyprland.ts` | Wayland/Hyprland adapter: `hyprctl` + `grim` |
| `src/platform/macos.ts` | macOS adapter: `screencapture` + `osascript` + `sips` |
| `src/bridge/client.ts` | `BridgeClient` class — HTTP POST to `/eval` and `/logs` endpoints |
| `src/bridge/tokenDiscovery.ts` | Token file scanning (`/tmp/tauri-dev-bridge-*.token`), PID liveness, stale cleanup |
| `src/util/image.ts` | `cropImage()`, `resizeImage()`, `computeCropRect()` — ImageMagick operations |
| `src/util/magick.ts` | `magickCommand()`, `detectMagickVersion()` — ImageMagick v6/v7 version detection and command resolution |
| `src/util/exec.ts` | `exec()` wrapper around `execFile()`, `validateWindowId()` |
| `examples/tauri-bridge/src/dev_bridge.rs` | Reference Rust bridge (~440 lines) — not part of build |

## Architecture

**Module system:** ESM (`"type": "module"`) with NodeNext resolution. All imports must use `.js` extensions (pointing to compiled output).

**Entry point:** `src/cli.ts` registers 25 commands via `commander`. Each command is in `src/commands/` or `src/commands/interact/`.

**Command registration pattern:** Each command file exports a `registerXxx(program, ...)` function. Commands that need the platform adapter receive `getAdapter` as a parameter. Commands that need the bridge use `resolveBridge()` from `shared.ts`, which handles auto-discovery or explicit `--port`/`--token`.

**Bridge resolution flow:** `resolveBridge()` in `shared.ts` → `discoverBridge()` in `tokenDiscovery.ts` → scans `/tmp/tauri-dev-bridge-*.token` files → parses JSON (`{ port, token, pid }`) → checks PID liveness via `process.kill(pid, 0)` → cleans stale files from dead processes → returns first live bridge config. If both `--port` and `--token` are provided, auto-discovery is skipped.

**Platform adapter pattern:** `src/platform/` has four adapters (X11, Wayland/Sway, Hyprland, macOS) implementing a common interface (`findWindow`, `captureWindow`, `getWindowGeometry`, `getWindowName`, `listWindows`). Detection logic in `src/platform/detect.ts` selects the adapter at runtime.

**ImageMagick version detection:** `src/util/magick.ts` detects ImageMagick v6 (standalone `convert`, `import`, etc.) vs v7 (unified `magick` binary) at startup. The `magickCommand()` function returns the correct binary and args for each subcommand. Result is cached after first detection.

**Bridge client:** `src/bridge/client.ts` communicates with a Rust dev bridge running inside the Tauri app via HTTP POST to a localhost `/eval` endpoint with token auth. Token auto-discovered from `/tmp/tauri-dev-bridge-*.token` files (see `src/bridge/tokenDiscovery.ts`).

**Crop computation:** Screenshot commands combine window geometry from the platform adapter with element rect from the bridge to compute crop regions, accounting for window decorations (title bar, borders).

**Rust bridge example:** `examples/tauri-bridge/src/dev_bridge.rs` (~440 lines) shows the Tauri-side HTTP server. Not part of the build — it's reference code for users integrating into their own Tauri apps.

## Key Constraints

- **Security:** Uses `execFile()` with array args everywhere — never `exec()` with shell strings. Window IDs validated with `/^\d+$/` before use.
- **Interaction commands are debug-only:** Click, type, scroll, focus, navigate, select, and invoke only work with the dev bridge (debug builds). They use eval-based DOM event dispatch.
- **Inspection commands are read-only:** No state modification from inspection commands. This is a deliberate design choice.
- **Node >=20 required:** Uses native `fetch()` (no HTTP library dependency).
- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch` enabled. Declarations generated to `dist/`.
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

## Module Dependency DAG

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

Dependencies flow strictly downward. Enforced by `scripts/check-imports.mjs`.

### Import Conventions

- Import schemas from their **domain file** directly: `import { BridgeConfigSchema } from '../schemas/bridge.js'`
- `types.ts` contains only pure interfaces (`WindowInfo`, `PlatformAdapter`, `DisplayServer`, `WindowListEntry`)
- Schema types used in interfaces are imported via `import type` from schemas/

### Safety Net Commands

```bash
npx tsc --noEmit                              # Type check
npm test                                      # All tests (623+ tests, 45 files)
node scripts/check-imports.mjs                # Import DAG linter
npx madge --circular --extensions ts,tsx src/  # Circular dependency check
```

## Agent Skills

`.agents/skills/` contains two Agent Skills (agentskills.io format) that teach AI agents how to use this tool and set up the Rust bridge. These are shipped in the npm package.
