---
name: tauri-agent-tools
description: CLI for inspecting and interacting with Tauri desktop apps — DOM queries, screenshots, interaction (click/type/scroll), IPC monitoring, store inspection, structured assertions
version: 0.6.0
tags: [tauri, desktop, debugging, screenshot, dom, inspection, diff, mutations, snapshot, interaction, click, type, scroll, invoke, probe, capture, check, store-inspect]
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

**Standalone** (no bridge needed):
`screenshot --title` (full window only), `wait --title`, `list-windows`, `info`, `diff`

**Optional bridge:**
`probe` (works standalone to discover bridges, richer output with bridge)

The bridge auto-discovers via token files in `/tmp/tauri-dev-bridge-*.token`. No manual port/token configuration needed.

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
| `screenshot` | `--selector <css>`, `--title <regex>`, `-o <path>`, `--max-width <n>` | selector: yes, title: no | Capture window or DOM element screenshot |
| `dom` | `[selector]`, `--depth <n>`, `--styles`, `--text <pattern>`, `--mode accessibility`, `--json` | yes | Query DOM structure or find elements by text |
| `eval` | `<js-expression>`, `--file <path>` | yes | Evaluate JavaScript in webview |
| `wait` | `--selector <css>`, `--eval <js>`, `--title <regex>`, `--timeout <ms>` | selector/eval: yes | Wait for a condition |
| `list-windows` | `--tauri`, `--json` | no | List visible windows |
| `info` | `--title <regex>`, `--json` | no | Window geometry and display info |
| `ipc-monitor` | `--filter <cmd>`, `--duration <ms>`, `--json` | yes | Monitor Tauri IPC calls |
| `console-monitor` | `--level <lvl>`, `--filter <regex>`, `--duration <ms>`, `--json` | yes | Monitor console output |
| `rust-logs` | `--level <lvl>`, `--target <regex>`, `--source <src>`, `--duration <ms>`, `--json` | yes | Monitor Rust logs and sidecar output |
| `storage` | `--type <local\|session\|cookies\|all>`, `--key <name>`, `--json` | yes | Inspect browser storage |
| `page-state` | `--json` | yes | URL, title, viewport, scroll, document size |
| `diff` | `<image1> <image2>`, `-o <path>`, `--threshold <pct>`, `--json` | no | Compare two screenshots |
| `mutations` | `<selector>`, `--attributes`, `--duration <ms>`, `--json` | yes | Watch DOM mutations |
| `snapshot` | `-o <prefix>`, `-s <css>`, `--dom-depth <n>`, `--eval <js>`, `--json` | yes | Screenshot + DOM + page state + storage |
| `click` | `<selector>`, `--double`, `--right`, `--wait <ms>`, `--json` | yes | Click a DOM element |
| `type` | `<selector> <text>`, `--clear`, `--json` | yes | Type text into an input |
| `scroll` | `--selector <css>`, `--by <px>`, `--to-top`, `--to-bottom`, `--into-view`, `--json` | yes | Scroll window or element |
| `focus` | `<selector>`, `--json` | yes | Focus a DOM element |
| `navigate` | `<target>`, `--json` | yes | Navigate within the app |
| `select` | `<selector> [value]`, `--toggle`, `--json` | yes | Select dropdown or toggle checkbox |
| `invoke` | `<command> [args-json]`, `--json` | yes | Invoke a Tauri IPC command |
| `probe` | `--pid <n>`, `--json` | optional | Discover targets and bridge health |
| `capture` | `-o <dir>`, `-s <css>`, `--logs-duration <ms>`, `--json` | yes | Full debug evidence bundle |
| `check` | `--selector`, `--text`, `--eval`, `--no-errors`, `--json` | yes | Structured assertions (exit 0/1) |
| `store-inspect` | `--framework`, `--store <name>`, `--depth <n>`, `--json` | yes | Inspect reactive store state |

## Targeting Flags

All bridge-dependent commands support these flags:
- `--port <n>` / `--token <s>` — explicit bridge config (skips auto-discovery)
- `--pid <n>` — target a specific app by PID
- `--window-label <label>` — target a specific webview window (default: main)

## Important Notes

- **Inspection commands are read-only.** They don't modify app state.
- **Interaction commands are debug-only.** They only work with the dev bridge (debug builds).
- **Use `--json`** for structured, parseable output in automation.
- **Always use `--duration`** with `ipc-monitor`, `console-monitor`, `rust-logs`, and `mutations`.
- **`screenshot --selector`** requires both the bridge AND platform screenshot tools (`imagemagick`).
- **Multi-app targeting:** Use `--pid` to target a specific app. Use `probe` to discover all running bridges.
