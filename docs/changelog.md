# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Changed

- `start_bridge()` now returns `(u16, Arc<LogBuffer>)` instead of `u16`
- Bridge example requires `tracing` and `tracing-subscriber` crate dependencies

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

## [0.1.0] - 2025-03-17

### Added

- Initial CLI with 11 commands: `screenshot`, `dom`, `eval`, `wait`, `info`, `list-windows`, `ipc-monitor`, `console-monitor`, `storage`, `page-state`
- Rust dev bridge with token-authenticated localhost HTTP server
- Platform support: Linux X11, Linux Wayland/Sway, macOS CoreGraphics
- Agent Skills (`.agents/skills/`) and `AGENTS.md` for agent-driven discovery
- DOM-targeted pixel capture using bridge + ImageMagick crop
- Auto-discovery of bridge via `/tmp` token files
- All commands read-only with `--json` structured output
