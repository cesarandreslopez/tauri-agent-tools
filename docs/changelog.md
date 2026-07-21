# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-07-21

Window targeting by platform id: the window-consuming commands can now skip the title-regex path entirely. Additive and backwards-compatible — no flag changed meaning and all output additions are optional-only.

### Added

- **`-w, --window-id <id>`** on `screenshot`, `info`, `snapshot`, and `capture` ([#9](https://github.com/cesarandreslopez/tauri-agent-tools/issues/9)) — target a window by its platform id (from `list-windows`) instead of a `--title` regex. Skips `findWindow()` entirely, so there is no shell-quoting risk (ids have no spaces) and windows a title regex can't uniquely or reliably match (e.g. unmapped/headless windows under `xdotool search`) become addressable. The id passes through unvalidated at the CLI layer — its format is adapter-specific (X11/macOS/Sway numeric, Hyprland hex `0x…`); adapters that shell-interpolate ids keep their existing `validateWindowId()` guards. `screenshot --window-id` full-window capture needs no bridge at all. Unrelated to `--window-label` (Tauri webview label, a bridge concept).
- Shared `resolveWindowId()` export from `src/commands/shared.ts` (windowId > title > bridge `document.title` precedence), replacing three duplicated per-command resolution helpers. `CaptureToDirOptions` gains an optional `windowId` field, and `screenshot --json` output now includes the resolved `windowId` (both additive).

### Changed

- `info --title` is no longer a required option — one of `--title` or `--window-id` suffices.
- `--title` help text on window-targeting commands now notes that titles containing spaces must be shell-quoted (an unquoted title splits at the shell and can substring-match the wrong window).

## [0.9.0] - 2026-07-15

Fork-uplift release: bug fixes and features generalized from the `contextful_debugger` fork. Everything is additive and backwards-compatible; schema additions are optional-only, and the bridge protocol change is opt-in by request shape.

### Added

- **`logs --follow`** (+ `--interval <ms>`) — tail live bridge logs until interrupted. Against a v0.8 bridge this uses non-draining cursor long-polls (seeded at cursor 0 to replay the buffered backlog) so multiple log consumers can coexist; evicted entries surface as a `dropped`-count warning. Against a pre-0.8 bridge it emits a one-time `note:` and degrades to drain polling every `--interval` ms.
- **`sidecar replay --tap-format` / `--dir in|out`** — unwrap `{dir,ts,line}` tap wrapper rows (the common shape for bidirectional IPC tap recordings) before replaying, optionally filtered by direction. Malformed wrapper rows fail with a line-numbered error.
- **`captureToDir()` library API** — `capture`'s pipeline is now an exported function (`src/commands/capture.ts`) returning the `CaptureManifest`, so other tooling can snapshot evidence programmatically. CLI behavior unchanged.
- **`BridgeClient.fetchLogs()` cursor overload** — passing `{cursor, waitMs, limit, timeoutMs}` returns `{entries, cursor?, dropped?}` via the non-draining v0.8 `/logs` cursor mode. A pre-0.8 bridge answers without a `cursor` field, so callers feature-detect by response shape with no extra round-trips (this is how `logs --follow` decides to degrade to drain polling). The legacy `fetchLogs(timeout?)` drain call is unchanged; log-entry/response schemas gain optional `id`, `cursor`, and `dropped` fields.
- **`scripts/check-bridge-parity.mjs`** (npm `check:bridge-parity`, part of `npm run lint`) — lint gate that regex-parses `BRIDGE_VERSION` + the endpoint list from `dev_bridge.rs` and `ENDPOINT_MIN_VERSION` from `client.ts`, failing on missing/extra entries or a min-version above `BRIDGE_VERSION` (semver compare, so legacy entries survive protocol bumps).

### Changed

- **Stronger artifact redaction** — `bundle` now redacts via the shared `src/util/redactText.ts` engine: Bearer/JWT/query-param/env-var secrets, AWS keys, emails, IPs, phone numbers, and home paths (including base64-encoded ones); `.json`/`.ndjson` artifacts are re-serialized so they stay parseable after masking. The redact phase reports `{redactions, warnings, failures}`, fails on write-back failures, and flags unredacted images as warnings. A `scanResidualSecrets()` helper (known token prefixes + Shannon-entropy gate with a configurable artifact-name allowlist) is available for downstream gates. Clock times and ISO timestamps (which share the IPv6 colon-group shape) and bare `~` prose (`~10s`) survive redaction unchanged.
- **`probe` reports instead of throwing when no bridge exists** — with nothing discoverable and no explicit `--port`/`--token`/`--pid`, probe now emits a complete result (JSON and human forms) with `target.alive=false` and an actionable `note`, so agents can branch on structured output.

### Changed — Rust dev bridge (re-copy recommended, drop-in)

- `BRIDGE_VERSION` bumped from `"0.7.0"` to `"0.8.0"`.
- **Cursor-mode `/logs`**: a request carrying `{cursor, waitMs ≤ 25000, limit 1..1000}` returns `{entries, cursor, dropped}` **without draining** the ring buffer; requests with `waitMs > 0` long-poll on a worker thread (the accept loop is serial). `LogEntry` gains a monotonic `id`. Bare `{token}` requests keep the legacy drain semantics unchanged, so pre-0.8 CLIs are unaffected.
- **Integrators can re-copy `examples/tauri-bridge/src/dev_bridge.rs` as a drop-in** — no `main.rs` signature changes this time. Without the re-copy, `logs --follow` degrades gracefully to drain polling.

### Fixed

- **Integer CLI flags now parse reliably.** Every `.option(..., parseInt, <default>)` coercion passed the option default to `parseInt` as its *radix*, so explicitly-passed values were ignored (`--interval 1000` → `NaN` → silent fallback to the default) or misparsed (`dom --depth 12`, default 3, parsed in base 3 as 5). All 24 numeric flag coercions now share a base-10 `parseIntArg()` helper in `commands/shared.ts`.
- **Bridge discovery now prefers the newest live bridge.** Token files are sorted by mtime (newest first, filename tie-break) instead of readdir order, so running several bridge-enabled apps no longer attaches the CLI to a stale instance.
- **`sidecar tap` no longer drops or reorders envelopes under bursty output.** Async chunk handling is serialized through a promise chain and `close` waits for it to drain before flushing the trailing line.

## [0.8.0] - 2026-06-19

Real-world observability hardening. Everything in this release is **additive and backwards-compatible**: no command was removed or renamed, no flag changed meaning, no default output changed, and all schema additions are optional-only. The existing test suite passes unchanged; new behavior is opt-in or only affects paths that previously errored.

### Added

- **`logs`** — merge a Tauri app's scattered logs into one timestamp-ordered stream. Discovers and normalizes the on-disk `tauri-plugin-log` LogDir files (auto-resolved from `tauri.conf.json`, an `--identifier`, or `--log-dir`/`--log-file`) and the live bridge `/logs` ring buffer, then emits NDJSON (`--pretty` for humans). Timezone-less timestamps are normalized to UTC so ordering is host-independent. Filters: `--level`, `--source`, `--filter`; `--correlate` infers `run_id`/`requestId`-style correlation ids. Works with no bridge.
- **`bundle`** — collect a shareable incident bundle (merged `logs` + deep `process-tree` + `app-paths` + `forensics`, plus an optional UI `capture`) into one directory and a `.tar.gz`. Secrets (`token`/`api_key`/`password`/…) are redacted from text artifacts on write. Best-effort: each phase degrades cleanly.
- **`process-tree --deep`** — walk the real OS process descendant tree (sidecar children, MCP servers, ML workers — including grandchildren the bridge never registered) via `ps`. Needs no bridge with an explicit `--pid`. New optional JSON fields: `ppid`, `children`, `source`, `descendants`.
- **`ipc-monitor --slow <ms>` / `--stats`** — flag IPC calls that completed but took ≥ N ms, and print a per-command latency summary (count, max, avg, errors) on exit.
- **`--strict` flag** (shared) — for the v0.7-endpoint commands, fail with the actionable upgrade error instead of degrading.

### Changed

- **Graceful degradation against older/vendored bridges.** `health`, `capabilities audit`, and `webview attach` now feature-detect via `GET /version` and emit a clear `note:` instead of throwing when the bridge predates v0.7 (default behavior; `--strict` restores the hard error). `process-tree` without `--deep` degrades to the OS walk when the bridge lacks `/process` and the app PID is resolvable, otherwise it still surfaces the actionable upgrade error. This fixes a latent regression where these commands hard-failed against any bridge older than v0.7.0.
- `BridgeClient` gained a non-throwing `hasEndpoint()` capability check (shares the `/version` cache with `requireEndpoint`).
- Agent skills (`tauri-agent-tools`, `tauri-debug-quickstart`, `tauri-bridge-setup`) updated to document the new commands and the degrade-by-default behavior; the now-inaccurate "emits an error against older bridges" guidance was corrected.

### Fixed

- **macOS window listing** on recent macOS. JXA's `ObjC.deepUnwrap` on `CGWindowListCopyWindowInfo` began returning a non-array, so `.map` threw `"list.map is not a function"` and broke every macOS window command (`screenshot`, `info`, `list-windows`, `snapshot`, `capture`). The adapter now reads the `CFArray` element-by-element via `CFArrayGetCount` / `CFArrayGetValueAtIndex` / `castRefToObject`, keeping the macOS adapter dependency-free on the built-in `osascript` (no PyObjC / pip). Thanks to **[@ethan-krich](https://github.com/ethan-krich)** ([#8](https://github.com/cesarandreslopez/tauri-agent-tools/pull/8)).

## [0.7.1] - 2026-05-18

### Fixed

- Bridge auto-discovery now scans both `os.tmpdir()` and `/tmp`, fixing macOS where the Rust dev bridge writes token files to `/tmp` but Node's `os.tmpdir()` resolves to `/var/folders/.../T/`. Closes #5.
- Dev bridge eval callbacks now use Tauri 2's `window.__TAURI_INTERNALS__.invoke` path first, so apps no longer need `app.withGlobalTauri: true` for bridge-backed commands (`dom`, `click`, `eval`, `page-state`, `screenshot --selector`, etc.). Closes #7.
- Documented the missing `libc = "0.2"` Cargo dependency in `rust-bridge/README.md` and `docs/getting-started/bridge-setup.md`. The bridge's `/process` and `/health` endpoints depend on `libc::kill()` for sidecar liveness probing on Unix. Closes #6.

## [0.7.0] - 2026-05-13

### Added — Agent UX (Tier 3)

- **`diagnose`** — best-effort super-command. Composes `forensics` (Tier 1) with live bridge data (Tier 2) into one bundle. Always runs the forensics half; layers `/process`, `/capabilities`, `/devtools`, `/health` on top when a bridge is reachable. Output: `<out-dir>/{summary.md, summary.json, bridge.json, forensics/...}`. Use `--no-bridge` to skip the bridge phase entirely.
- **New agent skill: `tauri-debug-quickstart`** — first-30-seconds triage skill with symptom → command table, decision flowchart, and "when this skill is wrong" caveats.
- **MkDocs troubleshooting page** — `docs/troubleshooting/decision-tree.md` with a mermaid flowchart mirroring the skill's symptom-table for human readers.

### Added — Bridge-extending diagnostics (Tier 2)

Four CLI commands that talk to new dev-bridge endpoints. Each calls `GET /version` first to feature-detect; against a pre-v0.7 bridge they emit `"requires bridge v0.7.0+ — re-copy examples/tauri-bridge/src/dev_bridge.rs"` instead of an opaque 404.

- **`process-tree`** — Tauri PID + registered sidecars rendered as a tree with `alive`/`DEAD` annotations.
- **`capabilities audit`** — Devtron-style live audit of declared Tauri capabilities, surfacing wildcard `"*"`, over-broad `fs:allow-all`/`shell:allow-*`/`http:allow-all`, and window labels referenced but not registered.
- **`webview attach`** — print the webview inspector URL (`webview2` / `webkitgtk`) or platform hint (`wkwebview` — Safari activation). `--print-url` for scripting, `--open` to launch the default browser.
- **`health`** — uptime + webview readiness + per-sidecar liveness. Exits non-zero when the app is unhealthy so this can drive CI gates.

### Added — Bridge-free diagnostics (Tier 1)

The toolkit can now diagnose Tauri apps without needing a live debug bridge — covering release builds, dead processes, and sidecar protocols.

- **`app-paths`** — resolve a Tauri 2 app's OS data/log/cache/config directories from `tauri.conf.json` (or a bare `--identifier`). Encodes Tauri 2's `PathResolver` semantics for all three platforms; `--exists` flag annotates which paths are present on disk.
- **`config inspect`** — emit a structured snapshot of `tauri.conf.json` plus a Devtron-style capability matrix. Cross-checks capability permissions against `Cargo.toml`'s plugin declarations and flags wildcard / over-broad scopes (`*`, `fs:allow-all`, `shell:allow-spawn`, …).
- **`os-logs`** — tail the host OS's log stream filtered to a Tauri bundle id. macOS uses `log stream` with a `subsystem == "<id>"` predicate; Linux uses `journalctl --user -t <productName>`. Output is one normalized NDJSON envelope per line. Windows is stubbed for v0.7.
- **`sidecar tap`** / **`sidecar replay`** — wrap-and-run a sidecar binary, frame its stdout as NDJSON, validate each envelope against an optional JSON Schema (`--schema <path>`, powered by Ajv), and record the raw stream to a file with `--record`. `sidecar replay` reads the recording back to stdout or pipes it into a fresh process via `--to-exec`, optionally rate-limited with `--rate <lps>`.
- **`forensics`** — one-shot bundle for post-crash analysis. Resolves the project, lists files in `appDataDir`/`appLogDir`, tails the most-recent log for panic markers, pulls macOS `DiagnosticReports` filtered by `productName`, captures a brief live OS-log tail, and writes `summary.md` + `summary.json` + supporting artifacts. Zero bridge calls — works on a dead app.

### Changed — Rust dev bridge (BREAKING for integrators)

- `BRIDGE_VERSION` bumped from `"0.6.0"` to `"0.7.0"`.
- Four new endpoints: `/process`, `/capabilities`, `/devtools`, `/health` (all POST + token auth).
- `start_bridge` now returns `(u16, Arc<LogBuffer>, Arc<SidecarRegistry>)` instead of `(u16, Arc<LogBuffer>)`. Integrators destructure the third element to register sidecars.
- `spawn_sidecar_monitored` now takes an optional `Option<&Arc<SidecarRegistry>>` so spawned sidecars appear in `process-tree`/`health`. Pass `None` to opt out.
- New `register_sidecar()` for users who spawn children manually.
- Added `libc = "0.2"` Cargo dep (Unix only) for the cheap `kill(pid, 0)` liveness probe.

**Integrators must re-copy `examples/tauri-bridge/src/dev_bridge.rs`** and adjust `main.rs` to destructure the new return shape. The CLI's new commands fail loudly with a "re-copy" error against older bridges, so partial upgrades are obvious.

### Internal

- New deps: `ajv` ^8, `ajv-formats` ^3 (NDJSON envelope schema validation).
- Command count: 25 → 36. Test count: 623 → 710.

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
