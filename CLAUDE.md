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
| `src/cli.ts` | Entry point — registers all 38 commands via `commander` |
| `src/schemas/` | Zod schemas split by domain: `bridge.ts`, `dom.ts`, `commands.ts`, `platform.ts`, `interact.ts` |
| `src/types.ts` | Pure interfaces: `WindowInfo`, `PlatformAdapter`, `DisplayServer`, `WindowListEntry` |
| `src/commands/` | One file per command (`screenshot.ts`, `dom.ts`, `eval.ts`, `wait.ts`, `info.ts`, `listWindows.ts`, `ipcMonitor.ts`, `consoleMonitor.ts`, `rustLogs.ts`, `storage.ts`, `pageState.ts`, `diff.ts`, `mutations.ts`, `snapshot.ts`, `check.ts`, `capture.ts`, `probe.ts`, `invoke.ts`, `storeInspect.ts`, plus v0.7 additions: `appPaths.ts`, `configInspect.ts`, `osLogs.ts`, `sidecarTap.ts`, `sidecarReplay.ts`, `forensics.ts`, `processTree.ts`, `capabilitiesAudit.ts`, `webviewAttach.ts`, `health.ts`, `diagnose.ts`, plus v0.8 additions: `logs.ts`, `bundle.ts`) |
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
| `src/util/logMerge.ts` | `parseLogLine()`, `normalizeRustLog()`, `inferCorrelation()` — log parsing/normalization for the `logs` command |
| `src/util/redactText.ts` | `redactText()`, `redactJson()`, `redactDir()`, `scanResidualSecrets()` — secrets/PII redaction for shared artifacts (`bundle`) |
| `src/util/mergeByTimestamp.ts` | `mergeByTimestamp()` — stable merge of timestamped streams into one UTC-ordered timeline |
| `src/util/psTree.ts` | `snapshotProcesses()`, `buildDescendantTree()` — OS process-tree walk for `process-tree --deep` / `bundle` |
| `examples/tauri-bridge/src/dev_bridge.rs` | Reference Rust bridge (~440 lines) — not part of build |

## Architecture

**Module system:** ESM (`"type": "module"`) with NodeNext resolution. All imports must use `.js` extensions (pointing to compiled output).

**Entry point:** `src/cli.ts` registers 38 commands via `commander`. Each command is in `src/commands/` or `src/commands/interact/`.

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

Publishing is automated by `.github/workflows/release.yml`, which fires on a pushed `v*` tag.

1. Update the version in `package.json`, and keep `package-lock.json` in sync (`npm install --package-lock-only`). The skill `version:` fields in `.agents/skills/*/SKILL.md` should match too.
2. Update `CHANGELOG.md` with a new `## [<version>] - <date>` section — the release workflow extracts this section verbatim as the GitHub Release body.
3. Commit on `main` (e.g. `chore: release v<version>`).
4. `git push origin main`, then `git tag v<version>` and `git push origin v<version>`. The tag must point at a commit that is on `main` (the workflow rejects it otherwise).
5. `release.yml` validates that the tag matches `package.json`, runs lint + build + tests, then `npm publish` (skips if already published) and creates the GitHub Release. **Do not run `npm publish` by hand.**

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
npm test                                      # All tests (749+ tests, 63 files)
node scripts/check-imports.mjs                # Import DAG linter
node scripts/check-bridge-parity.mjs          # Bridge endpoint/min-version parity (also part of npm run lint)
npx madge --circular --extensions ts,tsx src/  # Circular dependency check
```

## Agent Skills

`.agents/skills/` contains three Agent Skills (agentskills.io format): `tauri-agent-tools` (using the CLI), `tauri-bridge-setup` (adding the Rust bridge), and `tauri-debug-quickstart` (first-30-seconds triage / decision tree). These are shipped in the npm package.
