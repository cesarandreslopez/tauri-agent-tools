---
name: tauri-agent-tools
description: CLI for inspecting and interacting with Tauri desktop apps — DOM queries, screenshots, interaction (click/type/scroll), IPC monitoring, store inspection, structured assertions, plus bridge-free diagnostics (unified cross-layer logs, deep OS process trees, OS logs, app paths, sidecar NDJSON tap/replay, forensic bundles) and the `diagnose`/`bundle` super-commands for one-shot triage. Works against older/vendored bridges by degrading gracefully.
version: 0.9.1
tags: [tauri, desktop, debugging, screenshot, dom, inspection, diff, mutations, snapshot, interaction, click, type, scroll, invoke, probe, capture, check, store-inspect, logs, bundle, process-tree, forensics, os-logs, app-paths, sidecar, config-inspect, diagnose]
---

# tauri-agent-tools

CLI tool for agent-driven inspection and interaction with Tauri desktop applications. Inspection commands are read-only. Interaction commands (click, type, scroll, etc.) are debug-only — they only work when the app runs with the dev bridge enabled.

## Prerequisites

```bash
# Check if installed
which tauri-agent-tools

# Install globally if missing
npm install -g tauri-agent-tools
```

**System dependencies by platform:**

| Platform | Requirements |
|----------|-------------|
| Linux X11 | `xdotool`, `imagemagick` (`sudo apt install xdotool imagemagick`) |
| Linux Wayland/Sway | `swaymsg`, `grim`, `imagemagick` |
| Linux Wayland/Hyprland | `hyprctl` (included with Hyprland), `grim`, `imagemagick` |
| macOS | `imagemagick` (`brew install imagemagick`), Screen Recording permission |

## Bridge vs Standalone

Some commands require the Rust dev bridge running inside the Tauri app. Others work standalone.

**Bridge required** (needs running Tauri app with bridge):
`screenshot --selector`, `dom`, `eval`, `wait --selector`, `wait --eval`, `ipc-monitor`, `console-monitor`, `rust-logs`, `storage`, `page-state`, `mutations`, `snapshot`, `click`, `type`, `scroll`, `focus`, `navigate`, `select`, `invoke`, `capture`, `check`, `store-inspect`

**Bridge-enriched, but degrade gracefully** (use a v0.7+ bridge for full output; otherwise emit a clear note instead of failing — pass `--strict` to fail loudly):
`capabilities audit`, `webview attach`, `health` *(richer with bridge v0.7+)*

**Standalone** (no bridge needed):
`screenshot --title`/`--window-id` (full window only), `wait --title`, `list-windows`, `info`, `diff`, `logs`, `app-paths`, `config inspect`, `os-logs`, `sidecar tap`, `sidecar replay`, `forensics`

**Optional bridge** (work standalone, richer with a bridge):
`probe`, `process-tree` (use `--deep` for a bridge-free OS walk), `logs` (merges on-disk files alone, or also drains the bridge ring buffer), `bundle`, `diagnose`

The bridge auto-discovers via token files in `/tmp/tauri-dev-bridge-*.token`. No manual port/token configuration needed.

## Don't know where to start? `diagnose`

When something's wrong and you're not sure why, run:

```bash
tauri-agent-tools diagnose --config ./src-tauri -o ./diagnose-out
```

`diagnose` is a best-effort super-command. It always runs the bridge-free forensics half; if a dev bridge is reachable it also layers `/process`, `/capabilities`, `/devtools`, `/health` data. The master `summary.md` lists "Next steps" pointing at the right deeper command. See the [`tauri-debug-quickstart`](../tauri-debug-quickstart/SKILL.md) skill for a full symptom-to-command decision tree.

## Debugging decision tree (precision form)

When you know what you're looking at, jump straight to:

| Symptom | First command |
|---------|---------------|
| Don't know — give me everything | `tauri-agent-tools diagnose -o ./diag` |
| App is running and bridge is responding | Use the bridge-mediated commands listed above (`screenshot`, `dom`, `eval`, …) |
| Bridge isn't responding (release build, app crashed, pre-webview boot failure) | `tauri-agent-tools forensics -o ./forensics-out` |
| You only have the bundle id, no source tree | `tauri-agent-tools app-paths --identifier com.example.app --platform all --exists` |
| Need a structured snapshot of `tauri.conf.json` + capabilities | `tauri-agent-tools config inspect --json` |
| Suspicion: a sidecar process is emitting malformed/unexpected NDJSON | Run the sidecar under `tauri-agent-tools sidecar tap --schema <path> -- <cmd>` instead of under Tauri |
| OS-level error visible in Console.app/journalctl but not in app logs | `tauri-agent-tools os-logs --identifier com.example.app --level error --duration 30000` |

## Core Workflows

### Inspect DOM then screenshot an element

```bash
# 1. Find the target app
tauri-agent-tools list-windows --tauri

# 2. Explore DOM structure
tauri-agent-tools dom --depth 3

# 3. Narrow down to a specific subtree
tauri-agent-tools dom ".sidebar" --depth 2 --styles

# 4. Screenshot the element
tauri-agent-tools screenshot --selector ".sidebar .nav-item.active" -o /tmp/nav.png
```

### Monitor IPC calls

```bash
# Watch all IPC calls for 10 seconds
tauri-agent-tools ipc-monitor --duration 10000 --json

# Filter to specific commands
tauri-agent-tools ipc-monitor --filter "get_*" --duration 5000 --json
```

### Diagnose app state

```bash
# Check page URL, title, viewport, scroll position
tauri-agent-tools page-state --json

# Inspect storage
tauri-agent-tools storage --type local --json

# Check console for errors
tauri-agent-tools console-monitor --level error --duration 5000 --json
```

### Capture a full debug snapshot

```bash
# Screenshot + DOM + page state + storage in one call
tauri-agent-tools snapshot -o /tmp/debug --json
```

### Compare screenshots

```bash
# Pixel-level comparison
tauri-agent-tools diff /tmp/before.png /tmp/after.png --json

# Fail CI if more than 1% of pixels differ
tauri-agent-tools diff /tmp/expected.png /tmp/actual.png --threshold 1
```

### Monitor Rust logs and sidecar output

```bash
# Watch Rust tracing logs for 10 seconds
tauri-agent-tools rust-logs --duration 10000 --json

# Only warnings and errors (severity-based: warn shows warn+error)
tauri-agent-tools rust-logs --level warn --duration 5000 --json

# Filter to a specific Rust module
tauri-agent-tools rust-logs --target "myapp::db" --duration 5000 --json

# Only sidecar output (e.g. ffmpeg, python scripts)
tauri-agent-tools rust-logs --source sidecar --duration 10000 --json

# Specific sidecar
tauri-agent-tools rust-logs --source sidecar:ffmpeg --duration 5000 --json
```

### Merge scattered logs into one timeline (`logs`)

A real app spreads logs across the bridge ring buffer, the webview console, an on-disk `tauri-plugin-log` file, and sidecar output. `logs` discovers what's available, normalizes every source, and emits one **timestamp-ordered** stream (NDJSON by default; `--pretty` for humans). Works with no bridge.

```bash
# Merge the on-disk log dir (auto-resolved from tauri.conf.json) + the bridge ring buffer
tauri-agent-tools logs --config ./src-tauri --pretty

# No source tree handy? Locate the OS log dir from a bundle id; skip the bridge
tauri-agent-tools logs --identifier com.example.app --no-bridge

# Point at explicit files / a custom dir; filter + infer correlation ids (run_id, requestId…)
tauri-agent-tools logs --log-dir ~/Library/Logs/com.example.app --level warn --correlate
tauri-agent-tools logs --log-file /path/a.log --log-file /path/b.log --filter "block_id=42"

# Follow live bridge logs until Ctrl-C (v0.8 bridge: non-draining cursor reads,
# safe to run alongside other log consumers). Against a pre-0.8 bridge it emits
# a one-time note and degrades to drain polling every --interval ms.
tauri-agent-tools logs --follow --level warn
tauri-agent-tools logs --follow --interval 1000 --pretty
```

Each entry is `{ts, level, source, subsystem, message, origin}` (+ `correlation` with `--correlate`). `source` is `rust` / `sidecar:<name>` (bridge) or `file:<basename>` (disk). Timezone-less timestamps are read as UTC so ordering is host-independent.

### Bridge-extended diagnostics (process tree, capabilities, devtools, health)

These commands prefer richer endpoints on a v0.7+ bridge but **degrade gracefully** against older/vendored bridges: each calls `GET /version` first to feature-detect, and when an endpoint is missing it emits a clear `note:` (and falls back where it can) instead of failing. Pass `--strict` to make a missing endpoint a hard error instead.

```bash
# Tauri PID + registered sidecars (uses /process on a v0.7+ bridge).
# On older bridges it degrades to an OS walk when the app PID is resolvable.
tauri-agent-tools process-tree --json

# Walk the REAL OS descendant tree — sidecar children, MCP servers, ML workers —
# without the bridge at all (great for unregistered grandchildren):
tauri-agent-tools process-tree --deep --json
tauri-agent-tools process-tree --deep --pid 12345   # no bridge needed with an explicit PID

# Devtron-style live capability audit (uses /capabilities)
tauri-agent-tools capabilities audit --json
# findings[] flag wildcard "*", over-broad shell:/fs:/http: scopes,
# capabilities that reference window labels not actually registered, etc.

# Inspector URL or platform hint (uses /devtools)
tauri-agent-tools webview attach              # human-readable with hint
tauri-agent-tools webview attach --print-url  # URL alone (empty if none)
tauri-agent-tools webview attach --open       # launch in default browser

# "Is this app sick" check (uses /health). Exits non-zero on unhealthy.
tauri-agent-tools health --json
```

Sidecars only appear in the bridge's `/process` view (`process-tree` without `--deep`, and `health`) if integrators register them — by passing `Some(&registry)` to `dev_bridge::spawn_sidecar_monitored` or calling `dev_bridge::register_sidecar`. **`process-tree --deep` needs none of that** — it reads the live OS process table, so it surfaces unregistered children and grandchildren regardless.

### Bridge-free diagnostics (post-mortem & sidecar workflows)

These six commands need no live bridge — useful for release builds, dead apps, and sidecar processes.

```bash
# Resolve the app's OS data/log/cache/config dirs from tauri.conf.json
tauri-agent-tools app-paths --config ./src-tauri --json
# All three platforms (handy for cross-OS forensics)
tauri-agent-tools app-paths --config ./src-tauri --platform all --exists

# Structured snapshot of the app config + capability/permission audit
tauri-agent-tools config inspect --config ./src-tauri --json
# warnings[] flags wildcard "*" perms, fs:allow-all, capabilities referencing
# plugins not declared in Cargo.toml, sidecars declared without tauri-plugin-shell.

# OS-level log tail, filtered to a Tauri bundle id (NDJSON one-per-line)
tauri-agent-tools os-logs --identifier com.example.app --duration 5000
tauri-agent-tools os-logs --level error --source main --duration 30000

# Run a sidecar under a tap to see its stdio + validate against a JSON Schema
tauri-agent-tools sidecar tap --schema ./schema.json --record /tmp/run.ndjson -- node my-sidecar.js
# Replay deterministically
tauri-agent-tools sidecar replay /tmp/run.ndjson --to-exec node my-sidecar.js --rate 100

# One-shot forensic bundle for post-crash analysis. Works on a DEAD app.
tauri-agent-tools forensics --config ./src-tauri -o ./forensics-out
# → ./forensics-out/{summary.md,summary.json,project.json,app-log-tail.txt,live-os-log.ndjson}
# summary.md includes detected panic markers + suggested next commands.

# One-shot SHAREABLE incident bundle: merges logs + deep process tree + app-paths +
# forensics (+ optional UI capture) into one redacted directory and a .tar.gz.
tauri-agent-tools bundle --config ./src-tauri -o ./triage
# → ./triage/{logs.ndjson,process-tree.json,app-paths.json,forensics/,summary.md} + ./triage.tar.gz
tauri-agent-tools bundle --config ./src-tauri --with-capture -o ./triage   # also screenshot + DOM (needs bridge)
# Secrets (token/api_key/password/JWTs/AWS keys/…) and PII (emails, IPs, phone
# numbers, home paths) are redacted from text artifacts on write; unredacted
# images are flagged as warnings in the redact phase.
```

### Watch DOM mutations

```bash
# Observe child additions/removals for 10 seconds
tauri-agent-tools mutations "#todo-list" --duration 10000 --json

# Also track attribute changes
tauri-agent-tools mutations ".sidebar" --attributes --duration 5000
```

### Find elements by text

```bash
# Search for elements containing text
tauri-agent-tools dom --text "Settings" --first --json
```

### Interact with the app

```bash
# Click a button
tauri-agent-tools click ".submit-btn" --json

# Type into an input
tauri-agent-tools type "#search" "hello world" --json

# Clear and retype
tauri-agent-tools type "#email" "new@email.com" --clear --json

# App applies the value on a transition/async render: wait longer for it to stick
tauri-agent-tools type "#q" "term" --verify-timeout 2000 --json

# Scroll to bottom
tauri-agent-tools scroll --to-bottom --json

# Scroll element into view
tauri-agent-tools scroll --selector "#item-42" --into-view

# Focus an element
tauri-agent-tools focus "#username" --json

# Navigate to a route
tauri-agent-tools navigate "/settings" --json

# Select a dropdown value
tauri-agent-tools select "#country" "US" --json

# Toggle a checkbox
tauri-agent-tools select "input[type=checkbox]" --toggle --json

# Invoke a Tauri IPC command
tauri-agent-tools invoke get_release_context --json
tauri-agent-tools invoke save_item '{"id": 42}' --json
```

`type` and `select` write through the native value setter (so React/Vue/Svelte controlled inputs see the change) and re-read the element afterwards. `verification: "reverted"` (exit 1, with a `hint`) means the app rolled the write back — a controlled input that rejected it — and is the app's answer, not a tooling error. `verification: "transformed"` means the app reformatted the value and counts as success.

### Probe, capture, and check (workflow commands)

```bash
# Discover targets and check bridge health
tauri-agent-tools probe --json

# Capture a full debug evidence bundle
tauri-agent-tools capture -o /tmp/debug --json
# Produces: manifest.json, screenshot.png, dom.json, page-state.json, storage.json, console-errors.json, rust-logs.json

# Run structured assertions
tauri-agent-tools check --selector ".app-ready" --no-errors --json
tauri-agent-tools check --eval "document.querySelectorAll('.block').length > 0" --json
tauri-agent-tools check --text "Workflow loaded" --json
```

### Inspect reactive stores

```bash
# Auto-detect framework and list all stores
tauri-agent-tools store-inspect --json

# Inspect a specific store
tauri-agent-tools store-inspect --store executionStore --json
```

### Target specific apps and windows

```bash
# Target a specific app by PID
tauri-agent-tools page-state --pid 12345 --json

# Target a specific window in a multi-window app
tauri-agent-tools eval "document.title" --window-label overlay --json
```

## Command Reference

| Command | Key Flags | Bridge? | Description |
|---------|-----------|---------|-------------|
| `screenshot` | `--selector <css>`, `--title <regex>`, `--window-id <id>`, `-o <path>`, `--max-width <n>` | selector: yes, title/window-id: no | Capture window or DOM element screenshot |
| `dom` | `[selector]`, `--depth <n>`, `--styles`, `--text <pattern>`, `--mode accessibility`, `--json` | yes | Query DOM structure or find elements by text |
| `eval` | `<js-expression>`, `--file <path>` | yes | Evaluate JavaScript in webview |
| `wait` | `--selector <css>`, `--eval <js>`, `--title <regex>`, `--timeout <ms>` | selector/eval: yes | Wait for a condition |
| `list-windows` | `--tauri`, `--json` | no | List visible windows |
| `info` | `--title <regex>`, `--window-id <id>`, `--json` | no | Window geometry and display info |
| `ipc-monitor` | `--filter <cmd>`, `--duration <ms>`, `--slow <ms>`, `--stats`, `--json` | yes | Monitor Tauri IPC calls; flag slow calls + per-command latency summary |
| `console-monitor` | `--level <lvl>`, `--filter <regex>`, `--duration <ms>`, `--json` | yes | Monitor console output |
| `rust-logs` | `--level <lvl>`, `--target <regex>`, `--source <src>`, `--duration <ms>`, `--json` | yes | Monitor Rust logs and sidecar output |
| `storage` | `--type <local\|session\|cookies\|all>`, `--key <name>`, `--json` | yes | Inspect browser storage |
| `page-state` | `--json` | yes | URL, title, viewport, scroll, document size |
| `diff` | `<image1> <image2>`, `-o <path>`, `--threshold <pct>`, `--json` | no | Compare two screenshots |
| `mutations` | `<selector>`, `--attributes`, `--duration <ms>`, `--json` | yes | Watch DOM mutations |
| `snapshot` | `-o <prefix>`, `-s <css>`, `--window-id <id>`, `--dom-depth <n>`, `--eval <js>`, `--json` | yes | Screenshot + DOM + page state + storage |
| `click` | `<selector>`, `--double`, `--right`, `--wait <ms>`, `--json` | yes | Click a DOM element |
| `type` | `<selector> <text>`, `--clear`, `--verify-timeout <ms>`, `--json` | yes | Type text into an input (native setter, verified write) |
| `scroll` | `--selector <css>`, `--by <px>`, `--to-top`, `--to-bottom`, `--into-view`, `--json` | yes | Scroll window or element |
| `focus` | `<selector>`, `--json` | yes | Focus a DOM element |
| `navigate` | `<target>`, `--json` | yes | Navigate within the app |
| `select` | `<selector> [value]`, `--toggle`, `--verify-timeout <ms>`, `--json` | yes | Select dropdown or toggle checkbox (native `click()`, verified write) |
| `invoke` | `<command> [args-json]`, `--json` | yes | Invoke a Tauri IPC command |
| `probe` | `--pid <n>`, `--json` | optional | Discover targets and bridge health |
| `capture` | `-o <dir>`, `-s <css>`, `--window-id <id>`, `--logs-duration <ms>`, `--json` | yes | Full debug evidence bundle |
| `check` | `--selector`, `--text`, `--eval`, `--no-errors`, `--json` | yes | Structured assertions (exit 0/1) |
| `store-inspect` | `--framework`, `--store <name>`, `--depth <n>`, `--json` | yes | Inspect reactive store state |
| `app-paths` | `--config <path>`, `--identifier <id>`, `--platform <os>`, `--exists`, `--json` | no | Resolve Tauri 2 app's OS data/log/cache/config dirs |
| `config inspect` | `--config <path>`, `--capabilities-dir <path>`, `--cargo-toml <path>`, `--json` | no | Structured `tauri.conf.json` snapshot + capability audit |
| `os-logs` | `--identifier <id>`, `--level <lvl>`, `--source <src>`, `--since <dur>`, `--duration <ms>`, `--json` | no | Tail host OS log stream filtered to a Tauri bundle id |
| `sidecar tap` | `-- <cmd...>`, `--schema <path>`, `--record <path>`, `--raw`, `--json` | no | Wrap-and-run a sidecar, frame NDJSON, validate envelopes |
| `sidecar replay` | `<file>`, `--to-exec <cmd>`, `--rate <lps>`, `--loop`, `--tap-format`, `--dir in\|out` | no | Replay a recorded NDJSON sidecar stream; `--tap-format` unwraps `{dir,ts,line}` tap wrapper rows |
| `forensics` | `--config <path>`, `--identifier <id>`, `-o <dir>`, `--since <dur>`, `--json` | no | One-shot forensic bundle (works on dead apps) |
| `logs` | `--config <path>`, `--identifier <id>`, `--log-dir <path>`, `--log-file <path>`, `--level <lvl>`, `--source <re>`, `--filter <re>`, `--correlate`, `--follow`, `--interval <ms>`, `--no-bridge`, `--pretty` | optional | Merge on-disk log files + bridge ring buffer into one timestamp-ordered stream; `--follow` tails the bridge via v0.8 cursor reads (drain-polling fallback on older bridges) |
| `process-tree` | `--deep`, `--pid <n>`, `--json` | optional | Tauri PID + sidecars (bridge /process); `--deep` walks the full OS descendant tree without the bridge |
| `capabilities audit` | `--json` | yes (v0.7+) | Live Devtron-style audit of declared Tauri capabilities |
| `webview attach` | `--print-url`, `--open`, `--json` | yes (v0.7+) | Print webview inspector URL or platform hint |
| `health` | `--json` | yes (v0.7+) | Uptime + webview/sidecar liveness (exit non-zero if unhealthy) |
| `diagnose` | `--config <path>`, `-o <dir>`, `--since <dur>`, `--no-bridge`, `--json` | optional | Best-effort super-bundle (forensics + live bridge enrichment) |
| `bundle` | `--config <path>`, `-o <dir>`, `--with-capture`, `--no-archive`, `--json` | optional | Shareable incident bundle: logs + deep process tree + app-paths + forensics → redacted dir + .tar.gz |

## Targeting Flags

All bridge-dependent commands support these flags:
- `--port <n>` / `--token <s>` — explicit bridge config (skips auto-discovery)
- `--pid <n>` — target a specific app by PID
- `--window-label <label>` — target a specific webview window (default: main)
- `--strict` — for v0.7-endpoint commands, fail with an upgrade error instead of degrading when the bridge is too old

## Important Notes

- **Inspection commands are read-only.** They don't modify app state.
- **Interaction commands are debug-only.** They only work with the dev bridge (debug builds).
- **Use `--json`** for structured, parseable output in automation.
- **Always use `--duration`** with `ipc-monitor`, `console-monitor`, `rust-logs`, and `mutations`.
- **`screenshot --selector`** requires both the bridge AND platform screenshot tools (`imagemagick`).
- **Multi-app targeting:** Use `--pid` to target a specific app. Use `probe` to discover all running bridges.
