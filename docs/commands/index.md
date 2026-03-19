# Command Reference

tauri-agent-tools provides 14 read-only commands for inspecting Tauri applications.

## Command Summary

| Command | Bridge Required | Description |
|---------|:--------------:|-------------|
| [`screenshot`](screenshot.md) | Optional | Capture a screenshot of a window or DOM element |
| [`dom`](dom.md) | Yes | Query DOM structure or accessibility tree |
| [`eval`](eval.md) | Yes | Evaluate a JavaScript expression |
| [`wait`](wait.md) | Optional | Wait for a condition to be met |
| [`info`](info.md) | No | Show window geometry and display server info |
| [`list-windows`](list-windows.md) | No | List all visible windows, marking Tauri apps |
| [`ipc-monitor`](ipc-monitor.md) | Yes | Monitor Tauri IPC calls in real-time |
| [`console-monitor`](console-monitor.md) | Yes | Monitor console output in real-time |
| [`rust-logs`](rust-logs.md) | Yes | Monitor Rust backend logs and sidecar output |
| [`storage`](storage.md) | Yes | Inspect localStorage, sessionStorage, and cookies |
| [`page-state`](page-state.md) | Yes | Query webview page state |
| [`diff`](diff.md) | No | Compare two screenshots with difference metrics |
| [`mutations`](mutations.md) | Yes | Watch DOM mutations on a CSS selector |
| [`snapshot`](snapshot.md) | Yes | Capture screenshot + DOM + page state + storage in one shot |

## Categories

### Visual Capture

- **[screenshot](screenshot.md)** — capture full windows or specific DOM elements with real screen pixels
- **[diff](diff.md)** — compare two screenshots with pixel-level difference metrics
- **[snapshot](snapshot.md)** — capture screenshot + DOM tree + page state + storage in a single call

### DOM Inspection

- **[dom](dom.md)** — explore DOM tree structure, accessibility tree, computed styles
- **[eval](eval.md)** — run arbitrary JS expressions in the webview

### Monitoring

- **[ipc-monitor](ipc-monitor.md)** — watch Tauri IPC calls with timing and filtering
- **[console-monitor](console-monitor.md)** — capture console.log/warn/error output
- **[rust-logs](rust-logs.md)** — monitor Rust tracing/log output and sidecar processes
- **[mutations](mutations.md)** — watch DOM mutations with attribute tracking

### State Inspection

- **[storage](storage.md)** — read localStorage, sessionStorage, and cookies
- **[page-state](page-state.md)** — URL, title, viewport, scroll position, Tauri detection

### Window Management

- **[info](info.md)** — window geometry, position, display server
- **[list-windows](list-windows.md)** — enumerate windows with Tauri detection
- **[wait](wait.md)** — poll for windows, DOM elements, or JS conditions

## Common Patterns

### JSON output

All commands that produce structured output support `--json`:

```bash
tauri-agent-tools info --title "My App" --json
tauri-agent-tools dom --json
tauri-agent-tools storage --json
```

### Bridge auto-discovery

Commands that need the bridge automatically discover it via token files in `/tmp/`. You can override with explicit flags:

```bash
tauri-agent-tools dom --port 9876 --token abc123
```

### Duration-based monitoring

Monitor commands accept `--duration` to auto-stop:

```bash
tauri-agent-tools ipc-monitor --duration 5000
tauri-agent-tools console-monitor --duration 10000 --level error
tauri-agent-tools rust-logs --duration 10000 --level warn
```
