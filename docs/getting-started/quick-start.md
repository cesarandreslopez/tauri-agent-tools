# Quick Start

There are two ways to use tauri-agent-tools: **standalone** (no bridge needed) and **bridge-connected** (full feature set).

## Standalone (No Bridge)

These commands work with any window — no Tauri bridge required.

### 1. List windows

```bash
tauri-agent-tools list-windows
```

This shows all visible windows with their IDs, PIDs, and sizes. Tauri apps with an active bridge are marked.

### 2. Get window info

```bash
tauri-agent-tools info --title "My App"
```

Shows window geometry, position, and display server info.

### 3. Full window screenshot

```bash
tauri-agent-tools screenshot --title "My App" -o /tmp/full.png
```

Captures the entire window as a PNG.

### 4. Wait for a window

```bash
tauri-agent-tools wait --title "My App" --timeout 10000
```

Polls until a window with the matching title appears.

## Bridge-Connected (Full Features)

With the [bridge set up](bridge-setup.md) in your Tauri app, you get access to DOM-targeted commands.

### 1. Check page state

```bash
tauri-agent-tools page-state
```

Shows URL, title, viewport size, scroll position, and Tauri detection.

### 2. Explore the DOM

```bash
tauri-agent-tools dom --depth 3
tauri-agent-tools dom ".sidebar" --depth 2 --styles
```

### 3. Screenshot a specific element

```bash
tauri-agent-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png
tauri-agent-tools screenshot --selector "#main-canvas" --max-width 800 -o /tmp/canvas.png
```

### 4. Monitor IPC calls

```bash
tauri-agent-tools ipc-monitor --duration 10000
```

Watches Tauri IPC calls in real-time for 10 seconds.

### 5. Inspect storage

```bash
tauri-agent-tools storage --type local
```

### 6. Evaluate JavaScript

```bash
tauri-agent-tools eval "document.querySelectorAll('.item').length"
```

## What's Next

- [Bridge Setup](bridge-setup.md) — add the Rust bridge to your Tauri app
- [Command Reference](../commands/index.md) — all 38 commands with full options
- [Platform Support](../platform-support.md) — platform-specific details

## Reliable automation

Select an app with `--pid` when several bridges are running. Use `--window-label` for a secondary webview and `--window-id` for an OS window. Title matching is regex on X11 and substring matching on macOS/Wayland.

```bash
tauri-agent-tools eval 'Promise.resolve(document.readyState)' --json
tauri-agent-tools check --selector '#app' --no-errors --duration 1000 --json
tauri-agent-tools capture -o /tmp/evidence --json
```

Check exit status and capture `partial`/`warnings` before treating evidence as complete. JSON results go to stdout; fatal error envelopes and warnings go to stderr.
