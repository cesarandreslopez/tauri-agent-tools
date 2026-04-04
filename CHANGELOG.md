# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-04-04

### Added

- **Interaction commands** — `click`, `type`, `scroll`, `focus`, `navigate`, `select` for agent-driven UI interaction (debug builds only)
- `invoke` command — call Tauri IPC commands from the CLI with JSON payload support
- `store-inspect` command — inspect reactive store state (Pinia, Vue devtools, custom `__DEBUG_STORES__` hook)
- `capture` command — collect screenshot + DOM + page state + storage into a single debug evidence bundle
- `check` command — structured assertions against DOM state with pass/fail results
- `probe` command — target discovery and bridge health check
- `eval --file` option — load JavaScript from a file instead of inline string
- `--pid` and `--window-label` bridge options for multi-app and multi-window targeting
- `BridgeClient` multi-window eval via optional `windowLabel` parameter
- Zod schemas for interaction command results (`schemas/interact.ts`)
- Shared interaction utilities: `escapeSelector()`, `buildFindElementScript()`

### Changed

- Rust bridge example: added `/version` and `/describe` endpoints, multi-window eval support
- Command count increased from 14 to 25

## [0.5.1] - 2026-03-24

### Added

- `src/util/magick.ts` — ImageMagick version detection module with caching; auto-detects v6 (standalone `convert`) vs v7 (unified `magick` binary) at runtime ([#4](https://github.com/cesarandreslopez/tauri-agent-tools/issues/4))

### Fixed

- ImageMagick v7 compatibility — all ImageMagick invocations (`convert`, `import`, `identify`, `compare`) now route through the version-aware `magickCommand()` resolver, using `magick <subcommand>` on v7 and standalone commands on v6
- `resizeImage()` backslash escape bug — `-resize` argument was `800x\>` (literal backslash) instead of `800x>`, causing "invalid argument" errors on ImageMagick v7
- Tool availability checks (`detect.ts`) now recognize `magick` binary as valid ImageMagick installation, falling back to `convert` for v6

## [0.5.0] - 2026-03-23

### Added

- Hyprland Wayland compositor support via `HyprlandAdapter` using `hyprctl` for window management and `grim` for screenshots ([#3](https://github.com/cesarandreslopez/tauri-agent-tools/pull/3) by [@gabrielpgagne](https://github.com/gabrielpgagne))
- `HYPRLAND_INSTANCE_SIGNATURE` environment variable detection for automatic adapter selection
- `checkHyprlandTools()` for verifying Hyprland-specific tool availability
- `HyprClientSchema` Zod schema for validated `hyprctl clients -j` output

### Changed

- `DisplayServer` type now distinguishes `wayland-sway`, `wayland-hyprland`, and generic `wayland`
- `detectDisplayServer()` checks `SWAYSOCK` and `HYPRLAND_INSTANCE_SIGNATURE` for compositor-specific adapters
- `checkWaylandTools()` renamed to `checkSwayTools()` for clarity

## [0.4.0] - 2026-03-19

### Added

- `rust-logs` command — monitor Rust backend `tracing`/`log` output and sidecar process stdout/stderr in real-time via the bridge's `/logs` endpoint
- `RustLogEntry` type for structured Rust log entries with timestamp, level, target, message, and source fields
- `BridgeClient.fetchLogs()` method for polling the `/logs` endpoint with 404 detection for old bridges
- Severity-based level filtering (`--level warn` shows warn and error, matching Rust `RUST_LOG` convention)
- `--target <regex>` filtering by Rust module path
- `--source <source>` filtering by origin (`rust`, `sidecar`, `all`, or `sidecar:<name>`)
- Rust bridge: `LogBuffer` ring buffer (max 1000 entries), `BridgeLogLayer` tracing layer, `spawn_sidecar_monitored()` helper, `POST /logs` endpoint, `create_log_layer()` public API
- Zod schema validation at all trust boundaries
- Domain-split schema files (`schemas/bridge.ts`, `schemas/dom.ts`, `schemas/commands.ts`, `schemas/platform.ts`) with barrel re-export
- Cross-module boundary integration tests
- Import DAG linter (`scripts/check-imports.mjs`)

### Changed

- `start_bridge()` now returns `(u16, Arc<LogBuffer>)` instead of `u16`
- Bridge example requires `tracing` and `tracing-subscriber` crate dependencies
- Replaced manual validation with Zod enum schemas for levels, modes, and IDs
- Replaced `z.lazy` with getter-based recursion for recursive schemas
- Additional TypeScript strictness options enabled (`noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`)

### Fixed

- CLI output consistency, validation, and discoverability improvements
- Schema validation hardening, regex safety, and dedup X11 parser
- `parseEnum` generics updated for Zod v4 compatibility

## [0.3.0] - 2026-03-17

### Added

- `diff` command — compare two screenshots with pixel-level difference metrics, threshold gating, and diff image output
- `mutations` command — watch DOM mutations on a CSS selector with polling, attribute tracking, and auto-cleanup
- `snapshot` command — capture screenshot + DOM tree + page state + storage in a single invocation
- `dom --text <pattern>` option — find elements by text content (case-insensitive), respects `--first`, `--count`, and selector scoping

### Fixed

- CSS selector escaping in mutation observer now escapes backslashes before single quotes (consistent with bridge client)
- `dom --text` now scopes search to the provided selector instead of always searching `document.body`
- `dom --text --first` flag is now respected (was previously ignored)
- `diff --threshold` now throws a clear error when `identify` fails instead of silently reporting 0%

### Changed

- `buildSerializerScript` exported from `dom.ts` for reuse by `snapshot` command
- `formatEntry` and `MutationEntry` exported from `mutations.ts`
- `snapshot` deduplicates window discovery via shared `resolveWindowId` helper

## [0.2.1] - 2026-03-17

### Fixed

- CLI `--version` flag now reads from `package.json` instead of being hardcoded

## [0.2.0] - 2026-03-17

### Fixed

- Dev bridge now returns actual JS eval results instead of echoing back the expression string
- Uses Tauri command callback pattern (`__TAURI__.core.invoke`) for reliable round-trip evaluation
- All bridge-dependent commands (dom, eval, screenshot --selector, storage, console-monitor, ipc-monitor, page-state) now work correctly

### Changed

- Bridge setup requires `uuid` crate and `invoke_handler` registration in `main.rs`
- Updated integration guide and agent skill with new setup steps

## [0.1.0] - 2026-03-17

### Added

- Initial CLI with 10 commands: `screenshot`, `dom`, `eval`, `wait`, `info`, `list-windows`, `ipc-monitor`, `console-monitor`, `storage`, `page-state`
- Rust dev bridge with token-authenticated localhost HTTP server
- Platform support: Linux X11, Linux Wayland/Sway, macOS CoreGraphics
- Agent Skills (`.agents/skills/`) and `AGENTS.md` for agent-driven discovery
- DOM-targeted pixel capture using bridge + ImageMagick crop
- Auto-discovery of bridge via `/tmp` token files
- All commands read-only with `--json` structured output
