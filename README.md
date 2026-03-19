<div align="center">

# tauri-agent-tools

**Agent-driven inspection toolkit for Tauri desktop apps**

14 read-only commands to screenshot, inspect, and monitor Tauri apps from the CLI.

[![CI](https://github.com/cesarandreslopez/tauri-agent-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/cesarandreslopez/tauri-agent-tools/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/tauri-agent-tools.svg)](https://www.npmjs.com/package/tauri-agent-tools)
[![npm downloads](https://img.shields.io/npm/dm/tauri-agent-tools.svg)](https://www.npmjs.com/package/tauri-agent-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/Node-%3E%3D20-green.svg)](https://nodejs.org)

![tauri-agent-tools](assets/social-preview.png)

</div>

## The Problem

Debugging frontend issues in Tauri desktop apps requires manually screenshotting, cropping, and describing what you see. Existing tools either hijack your cursor (xcap-based), render DOM to canvas (html2canvas — can't capture WebGL/video/canvas), or have no authentication.

## The Solution

Combine a bridge's knowledge of element positions (`getBoundingClientRect`) with real pixel screenshots (`import -window` + ImageMagick crop). No other tool does this.

```bash
# Screenshot a specific DOM element with real pixels
tauri-agent-tools screenshot --selector ".wf-toolbar" -o /tmp/toolbar.png
tauri-agent-tools screenshot --selector "#canvas-area" -o /tmp/canvas.png

# Explore DOM structure first
tauri-agent-tools dom --depth 3
tauri-agent-tools dom ".wf-canvas" --depth 4

# Then screenshot what you found
tauri-agent-tools screenshot --selector ".wf-canvas .block-node" -o /tmp/block.png
```

## Install

```bash
npm install -g tauri-agent-tools
```

**System requirements:**
- **Linux X11:** `xdotool`, `imagemagick` (`sudo apt install xdotool imagemagick`)
- **Linux Wayland/Sway:** `swaymsg`, `grim`, `imagemagick`
- **macOS:** `imagemagick` (`brew install imagemagick`) — all other tools are built-in. Grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording.

## Quick Start

### 1. Add the bridge to your Tauri app

See [rust-bridge/README.md](rust-bridge/README.md) for step-by-step integration.

The bridge runs a localhost-only, token-authenticated HTTP server during development. It auto-cleans up on exit.

### 2. Use the CLI

```bash
# DOM-targeted screenshot (needs bridge)
tauri-agent-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png
tauri-agent-tools screenshot --selector "#main-canvas" --max-width 800 -o /tmp/canvas.png

# Full window screenshot (no bridge needed, works with any window)
tauri-agent-tools screenshot --title "My App" -o /tmp/full.png

# Explore DOM
tauri-agent-tools dom --depth 3
tauri-agent-tools dom ".sidebar" --depth 2 --styles

# Evaluate JS
tauri-agent-tools eval "document.title"
tauri-agent-tools eval "document.querySelectorAll('.item').length"

# Wait for conditions
tauri-agent-tools wait --selector ".toast-message" --timeout 5000
tauri-agent-tools wait --title "My App" --timeout 10000

# Window info
tauri-agent-tools info --title "My App" --json
```

## Commands

### `screenshot`

Capture a screenshot of a window or DOM element.

| Option | Description |
|--------|-------------|
| `-s, --selector <css>` | CSS selector — screenshot just this element (requires bridge) |
| `-t, --title <regex>` | Window title to match |
| `-o, --output <path>` | Output file path (default: auto-named) |
| `--format <png\|jpg>` | Output format (default: png) |
| `--max-width <number>` | Resize to max width |
| `--port <number>` | Bridge port (auto-discover if omitted) |
| `--token <string>` | Bridge token (auto-discover if omitted) |

### `dom`

Query DOM structure from the Tauri app.

| Option | Description |
|--------|-------------|
| `[selector]` | Root element to explore (default: body) |
| `--mode <mode>` | Output mode: `dom` (default) or `accessibility` |
| `--depth <number>` | Max child depth (default: 3) |
| `--tree` | Compact tree view (default) |
| `--styles` | Include computed styles |
| `--text <pattern>` | Find elements containing this text (case-insensitive) |
| `--count` | Just output match count |
| `--first` | Only return first match |
| `--json` | Full structured JSON output |

### `eval`

Evaluate a JavaScript expression in the Tauri app.

```bash
tauri-agent-tools eval "document.title"
```

### `wait`

Wait for a condition to be met.

| Option | Description |
|--------|-------------|
| `-s, --selector <css>` | Wait for CSS selector to match |
| `-e, --eval <js>` | Wait for JS expression to be truthy |
| `-t, --title <regex>` | Wait for window with title (no bridge) |
| `--timeout <ms>` | Maximum wait time (default: 10000) |
| `--interval <ms>` | Polling interval (default: 500) |

### `info`

Show window geometry and display server info.

```bash
tauri-agent-tools info --title "My App" --json
```

### `list-windows`

List all visible windows, marking Tauri apps.

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--tauri` | Only show Tauri app windows |

### `ipc-monitor`

Monitor Tauri IPC calls in real-time (read-only). Monkey-patches `window.__TAURI__.core.invoke` to capture calls, then polls and restores on exit.

| Option | Description |
|--------|-------------|
| `--filter <command>` | Only show specific IPC commands (supports `*` wildcards) |
| `--interval <ms>` | Poll interval in milliseconds (default: 500) |
| `--duration <ms>` | Auto-stop after N milliseconds |
| `--json` | Output one JSON object per line |

### `console-monitor`

Monitor console output (log/warn/error/info/debug) in real-time. Monkey-patches console methods to capture entries, then polls and restores on exit.

| Option | Description |
|--------|-------------|
| `--level <level>` | Filter by level (log, warn, error, info, debug) |
| `--filter <regex>` | Filter messages by regex pattern |
| `--interval <ms>` | Poll interval in milliseconds (default: 500) |
| `--duration <ms>` | Auto-stop after N milliseconds |
| `--json` | Output one JSON object per line |

### `storage`

Inspect localStorage, sessionStorage, and cookies from the Tauri webview. One-shot read — no writes.

| Option | Description |
|--------|-------------|
| `--type <type>` | Storage type: `local`, `session`, `cookies`, `all` (default: all) |
| `--key <name>` | Get a specific key's value |
| `--json` | Output as JSON |

### `page-state`

Query webview page state: URL, title, viewport, scroll position, document size, and Tauri detection.

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `diff`

Compare two screenshots and output difference metrics.

| Option | Description |
|--------|-------------|
| `<image1>` | First image path |
| `<image2>` | Second image path |
| `-o, --output <path>` | Diff image output path |
| `--threshold <percent>` | Fail (exit code 1) if difference exceeds this percentage |
| `--json` | Output structured JSON |

### `mutations`

Watch DOM mutations on a CSS selector (read-only). Patches a `MutationObserver` into the webview, polls for changes, and cleans up on exit.

| Option | Description |
|--------|-------------|
| `<selector>` | CSS selector of the element to observe |
| `--attributes` | Also watch attribute changes |
| `--interval <ms>` | Poll interval in milliseconds (default: 500) |
| `--duration <ms>` | Auto-stop after N milliseconds |
| `--json` | Output one JSON object per line |

### `snapshot`

Capture screenshot + DOM tree + page state + storage in one shot. Writes multiple files with a shared prefix.

| Option | Description |
|--------|-------------|
| `-o, --output <prefix>` | Output path prefix (e.g. `/tmp/debug`) |
| `-s, --selector <css>` | CSS selector to screenshot (full window if omitted) |
| `-t, --title <regex>` | Window title to match (default: auto-discover) |
| `--dom-depth <number>` | DOM tree depth (default: 3) |
| `--eval <js>` | Additional JS to eval and save |
| `--json` | Output structured manifest |

### `rust-logs`

Monitor Rust backend logs and sidecar output in real-time. Unlike `console-monitor` (which captures JavaScript console output), this captures Rust `tracing`/`log` output and sidecar process stdout/stderr via the bridge's `/logs` endpoint.

| Option | Description |
|--------|-------------|
| `--level <level>` | Minimum log level: `trace`, `debug`, `info`, `warn`, `error` |
| `--target <regex>` | Filter by Rust module path (e.g. `myapp::db`) |
| `--source <source>` | Filter by source: `rust`, `sidecar`, `all`, or `sidecar:<name>` (default: all) |
| `--filter <regex>` | Filter messages by regex pattern |
| `--interval <ms>` | Poll interval in milliseconds (default: 500) |
| `--duration <ms>` | Auto-stop after N milliseconds |
| `--json` | Output one JSON object per line |

## How It Works

```
screenshot --selector ".toolbar" --title "My App"
  │
  ├─► Bridge client ──► POST /eval ──► getBoundingClientRect(".toolbar")
  │                                     returns { x, y, width, height }
  │
  ├─► Platform adapter ──► import -window WID png:- (capture full window)
  │
  ├─► Compute crop region:
  │     element rect from bridge + viewport offset (outerHeight - innerHeight)
  │
  └─► convert png:- -crop WxH+X+Y +repage png:- (crop to element)
```

The crop accounts for window decoration (title bar, borders) by comparing `window.innerHeight` from the bridge with the actual window height from `xdotool`.

## Platform Support

| Platform | Display Server | Status |
|----------|---------------|--------|
| Linux | X11 | Supported |
| Linux | Wayland (Sway) | Supported |
| macOS | CoreGraphics | Supported |
| Windows | - | Planned |

## Design Decisions

### Why no write operations

All commands are read-only. We don't inject clicks, keystrokes, scroll events, or any input into the Tauri webview. Reasons:

- **Native input injection is risky.** X11 input injection (e.g. via `xdotool`) operates system-wide, not per-window — it can grab the mouse cursor and require a hard reboot to recover.
- **Simulated events don't work.** `dispatchEvent()` creates events with `isTrusted: false`. Frameworks (React, Vue, Angular) and browsers reject untrusted events for security-sensitive operations.
- **Input injection is fragile across platforms.** X11 (`xdotool`), Wayland (no global input protocol by design), and macOS (requires Accessibility permission + sandbox restrictions) each have different security models. A cross-platform injection layer would be unreliable.
- **Read-only is a safer contract for dev tool automation.** Tools that can only observe cannot corrupt application state, trigger unintended side effects, or create security vulnerabilities in CI pipelines.

### Why no MCP server mode

This tool is a CLI that runs commands and exits — not a persistent MCP server. Reasons:

- **No daemon to manage.** No port to monitor, no process to restart, no state to leak between sessions.
- **No `.mcp.json` auto-start risk.** MCP servers start automatically when a project opens in supporting editors. A dev tool that auto-starts and connects to your running app on project open is a footgun.
- **No transport complexity.** No WebSocket/stdio state machine, no reconnection logic, no transport-layer bugs.
- **Composable with any agent framework.** Commands return structured output (`--json`) that any tool-use system can call directly. Define each command as a tool — no MCP SDK dependency required.

## Safety Guarantees

- **No input injection** — no mouse moves, clicks, keystrokes, or cursor changes
- **No xcap crate** — uses `xdotool` + ImageMagick `import` (read-only X11 operations)
- **No daemon** — CLI runs and exits, no background processes
- **No `.mcp.json`** — never auto-starts
- **All OS interactions read-only** — `xdotool search`, `getwindowgeometry`, `import -window`
- **Token authenticated bridge** — random 32-char token, localhost-only
- **`execFile` (array args)** — never `exec` (shell string), prevents command injection
- **Window ID validated** — must match `/^\d+$/`

## Agent Integration

This package ships [Agent Skills](https://agentskills.io) so AI coding agents can automatically learn how to use the CLI and set up the bridge.

| Skill | Description |
|-------|-------------|
| `tauri-agent-tools` | Using all 14 CLI commands to inspect Tauri apps |
| `tauri-bridge-setup` | Adding the Rust dev bridge to a Tauri project |

<details>
<summary><strong>Claude Code</strong></summary>

Claude Code auto-discovers skills from `.agents/skills/` in the current project. If you installed `tauri-agent-tools` globally and want skills available everywhere:

```bash
cp -r "$(npm root -g)/tauri-agent-tools/.agents" ~/.agents
```
</details>

<details>
<summary><strong>Codex</strong></summary>

Codex reads `AGENTS.md` at the repo root and skills from `node_modules`. Install locally:

```bash
npm install tauri-agent-tools
```

Codex will pick up `AGENTS.md` and `.agents/skills/` automatically.
</details>

<details>
<summary><strong>Cursor / VS Code Copilot</strong></summary>

Copy skills into your project so the agent can discover them:

```bash
cp -r node_modules/tauri-agent-tools/.agents .agents
```

Or if installed globally:

```bash
cp -r "$(npm root -g)/tauri-agent-tools/.agents" .agents
```
</details>

<details>
<summary><strong>Other agents</strong></summary>

Any [agentskills.io](https://agentskills.io)-compatible agent can read the skills from `.agents/skills/` in this package. Install globally or locally and point the agent at the skill directory.
</details>

## Documentation

Full documentation is available at the [docs site](https://cesarandreslopez.github.io/tauri-agent-tools/):

- [Installation](https://cesarandreslopez.github.io/tauri-agent-tools/getting-started/installation/) — system requirements and setup
- [Quick Start](https://cesarandreslopez.github.io/tauri-agent-tools/getting-started/quick-start/) — get running in 5 minutes
- [Bridge Setup](https://cesarandreslopez.github.io/tauri-agent-tools/getting-started/bridge-setup/) — integrate the Rust bridge into your Tauri app
- [Command Reference](https://cesarandreslopez.github.io/tauri-agent-tools/commands/) — all 14 commands with examples
- [Platform Support](https://cesarandreslopez.github.io/tauri-agent-tools/platform-support/) — X11, Wayland, macOS details
- [Architecture](https://cesarandreslopez.github.io/tauri-agent-tools/architecture/overview/) — how it works under the hood

## Development

```bash
npm install
npm run build
npm test
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup and prerequisites
- Code style and conventions
- Branch naming and commit message format
- Pull request process

## Community

- [Open an issue](https://github.com/cesarandreslopez/tauri-agent-tools/issues) for bugs or feature requests
- Star the repo if you find it useful

## License

MIT
