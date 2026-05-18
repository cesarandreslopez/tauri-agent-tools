# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Bridge auto-discovery now scans both `os.tmpdir()` and `/tmp`, fixing macOS when the Rust dev bridge writes token files to `/tmp`.

## [0.7.0] - 2026-05-13

### Added — Agent UX (Tier 3)

- **`diagnose`** — best-effort super-command. Composes `forensics` (Tier 1) with live bridge data (Tier 2) into one bundle. Always runs the forensics half; layers `/process`, `/capabilities`, `/devtools`, `/health` on top when a bridge is reachable. Each bridge endpoint is best-effort with per-endpoint error recording — partial bridge availability still produces a useful bundle. Output: `<out-dir>/{summary.md, summary.json, bridge.json, forensics/...}`. Use `--no-bridge` to skip the bridge phase entirely.
- **New agent skill: `tauri-debug-quickstart`** — first-30-seconds triage skill (`.agents/skills/tauri-debug-quickstart/SKILL.md`). Symptom → command table, decision flowchart, and an explicit "when this skill is wrong" section calling out Tauri 1, Windows, and release-build caveats.
- **MkDocs troubleshooting page** — `docs/troubleshooting/decision-tree.md` with a mermaid flowchart mirroring the skill's symptom-table for human readers. Wired into `mkdocs.yml` nav.

### Added — Bridge-extending diagnostics (Tier 2)

Four CLI commands that talk to new dev-bridge endpoints. Each calls `GET /version` first to feature-detect; against a pre-v0.7 bridge they emit `"requires bridge v0.7.0+ — re-copy examples/tauri-bridge/src/dev_bridge.rs"` instead of an opaque 404.

- **`process-tree`** — Tauri PID + registered sidecars rendered as a tree with `alive`/`DEAD` annotations.
- **`capabilities audit`** — Devtron-style live audit of declared Tauri capabilities, surfacing wildcard `"*"`, over-broad `fs:allow-all`/`shell:allow-*`/`http:allow-all`, and window labels referenced but not registered.
- **`webview attach`** — print the webview inspector URL (`webview2` / `webkitgtk`) or platform hint (`wkwebview` — Safari activation). `--print-url` for scripting, `--open` to launch the default browser.
- **`health`** — uptime + webview readiness + per-sidecar liveness. Exits non-zero when the app is unhealthy so this can drive CI gates.

### Changed — Rust dev bridge (BREAKING for integrators)

- `BRIDGE_VERSION` bumped from `"0.6.0"` to `"0.7.0"`.
- Four new endpoints: `/process`, `/capabilities`, `/devtools`, `/health` (all POST + token auth).
- `start_bridge` now returns `(u16, Arc<LogBuffer>, Arc<SidecarRegistry>)` instead of `(u16, Arc<LogBuffer>)`. Integrators destructure the third element to register sidecars.
- `spawn_sidecar_monitored` now takes an optional `Option<&Arc<SidecarRegistry>>` so spawned sidecars appear in `process-tree`/`health`. Pass `None` to opt out.
- New `register_sidecar()` for users who spawn children manually.
- Added `libc = "0.2"` Cargo dep (Unix only) for the cheap `kill(pid, 0)` liveness probe.

**Integrators must re-copy `examples/tauri-bridge/src/dev_bridge.rs`** and adjust `main.rs` to destructure the new return shape. The CLI's new commands fail loudly with a "re-copy" error against older bridges, so partial upgrades are obvious.

### Internal

- `src/bridge/client.ts` — new `requireEndpoint()` helper caches `/version` per `BridgeClient` instance, translating missing endpoints into actionable upgrade errors.
- `src/schemas/bridge.ts` — added `ProcessResponseSchema`, `CapabilitiesResponseSchema`, `DevtoolsResponseSchema`, `HealthResponseSchema`.
- `examples/tauri-bridge/` — added minimal `tauri.conf.json`, `build.rs`, placeholder icon, and a `frontend-stub/index.html` so the example crate actually compiles for the first time (it never did).
- Test count: 696 → 710 (added 7 BridgeClient v0.7 tests + 7 command e2e tests).

### Added — Bridge-free diagnostics (Tier 1 of "expand beyond the bridge")

The toolkit can now diagnose Tauri apps without needing a live debug bridge — covering release builds, dead processes, and sidecar protocols.

- **`app-paths`** — resolve a Tauri 2 app's OS data/log/cache/config directories from `tauri.conf.json` (or a bare `--identifier`). Encodes Tauri 2's `PathResolver` semantics for all three platforms; `--exists` flag annotates which paths are present on disk.
- **`config inspect`** — emit a structured snapshot of `tauri.conf.json` plus a Devtron-style capability matrix. Cross-checks capability permissions against `Cargo.toml`'s plugin declarations and flags wildcard / over-broad scopes (`*`, `fs:allow-all`, `shell:allow-spawn`, …).
- **`os-logs`** — tail the host OS's log stream filtered to a Tauri bundle id. macOS uses `log stream` with a `subsystem == "<id>"` predicate; Linux uses `journalctl --user -t <productName>`. Output is one normalized NDJSON envelope per line (`{ ts, level, source, subsystem, message, raw }`). Windows is stubbed for v0.7.
- **`sidecar tap`** / **`sidecar replay`** — wrap-and-run a sidecar binary, frame its stdout as NDJSON, validate each envelope against an optional JSON Schema (`--schema <path>`, powered by Ajv), and record the raw stream to a file with `--record`. `sidecar replay` reads the recording back to stdout or pipes it into a fresh process via `--to-exec`, optionally rate-limited with `--rate <lps>`.
- **`forensics`** — one-shot bundle for post-crash analysis. Resolves the project, lists files in `appDataDir`/`appLogDir`, tails the most-recent log for panic markers, pulls macOS `DiagnosticReports` filtered by `productName`, captures a brief live OS-log tail, and writes `summary.md` + `summary.json` + supporting artifacts. Zero bridge calls — works on a dead app.

### Internal

- `src/util/tauriConfig.ts` — `tauri.conf.json` loader (JSONC-tolerant), identifier resolver for v1+v2 layouts, capability discovery, `resolveTauriPaths` matching the `dirs` crate semantics for all three platforms.
- `src/util/ndjson.ts` — `LineFramer` (CRLF/LF, chunked input, blank-line preservation) and `NdjsonValidator` (Ajv wrapper that distinguishes parse errors from schema mismatches).
- `src/platform/oslog/{darwin,linux,windows}.ts` — per-platform OS log adapter pattern, mirrors the existing `src/platform/{x11,wayland,...}.ts` shape.
- Per-domain schemas: `src/schemas/{tauriConfig,osLog,sidecar}.ts`.
- New dependencies: `ajv` ^8, `ajv-formats` ^3 — loaded via `createRequire` to dodge ESM/CJS interop friction.
- Command count: 25 → 31. Test count: 623 → 696.

### Notes for skill / docs consumers

- The agent skill (`.agents/skills/tauri-agent-tools`) now distinguishes bridge-required vs bridge-free commands, and adds a debugging decision tree: bridge is healthy → existing 25 commands; bridge isn't responding → start with `forensics`; sidecar is the suspect → `sidecar tap`.

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
