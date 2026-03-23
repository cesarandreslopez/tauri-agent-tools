---
name: tauri-agent-tools
description: CLI for inspecting Tauri desktop apps — DOM queries, screenshots, IPC/console monitoring, storage, and page state
version: 0.4.0
tags: [tauri, desktop, debugging, screenshot, dom, inspection, diff, mutations, snapshot]
---

# tauri-agent-tools

CLI tool for agent-driven inspection of Tauri desktop applications. All commands are **read-only** — no input injection, no writes, no side effects.

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
`screenshot --selector`, `dom`, `eval`, `wait --selector`, `wait --eval`, `ipc-monitor`, `console-monitor`, `rust-logs`, `storage`, `page-state`, `mutations`, `snapshot`

**Standalone** (no bridge needed):
`screenshot --title` (full window only), `wait --title`, `list-windows`, `info`, `diff`

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

## Command Reference

| Command | Key Flags | Bridge? | Description |
|---------|-----------|---------|-------------|
| `screenshot` | `--selector <css>`, `--title <regex>`, `-o <path>`, `--max-width <n>` | selector: yes, title: no | Capture window or DOM element screenshot |
| `dom` | `[selector]`, `--depth <n>`, `--styles`, `--text <pattern>`, `--mode accessibility`, `--json` | yes | Query DOM structure or find elements by text |
| `eval` | `<js-expression>` | yes | Evaluate JavaScript in webview |
| `wait` | `--selector <css>`, `--eval <js>`, `--title <regex>`, `--timeout <ms>` | selector/eval: yes | Wait for a condition |
| `list-windows` | `--tauri`, `--json` | no | List visible windows |
| `info` | `--title <regex>`, `--json` | no | Window geometry and display info |
| `ipc-monitor` | `--filter <cmd>`, `--duration <ms>`, `--json` | yes | Monitor Tauri IPC calls |
| `console-monitor` | `--level <lvl>`, `--filter <regex>`, `--duration <ms>`, `--json` | yes | Monitor console output |
| `rust-logs` | `--level <lvl>`, `--target <regex>`, `--source <src>`, `--duration <ms>`, `--json` | yes | Monitor Rust logs and sidecar output |
| `storage` | `--type <local\|session\|cookies\|all>`, `--key <name>`, `--json` | yes | Inspect browser storage |
| `page-state` | `--json` | yes | URL, title, viewport, scroll, document size |
| `diff` | `<image1> <image2>`, `-o <path>`, `--threshold <pct>`, `--json` | no | Compare two screenshots with difference metrics |
| `mutations` | `<selector>`, `--attributes`, `--duration <ms>`, `--json` | yes | Watch DOM mutations on a CSS selector |
| `snapshot` | `-o <prefix>`, `-s <css>`, `--dom-depth <n>`, `--eval <js>`, `--json` | yes | Capture screenshot + DOM + page state + storage in one shot |

## Important Notes

- **All read-only.** No commands modify app state, inject input, or write to storage.
- **Use `--json`** for structured, parseable output in automation.
- **Always use `--duration`** with `ipc-monitor`, `console-monitor`, `rust-logs`, and `mutations` — without it, they run indefinitely.
- **`screenshot --selector`** requires both the bridge AND platform screenshot tools (`imagemagick`).
- **One bridge at a time.** Auto-discovery picks the first token file found. If multiple Tauri apps run simultaneously, use `--port` and `--token` explicitly.
