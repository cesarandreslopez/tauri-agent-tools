# tauri-dev-tools

DOM-targeted pixel capture for Tauri apps. Screenshot specific DOM elements with real screen pixels — not canvas renders.

## The Problem

Debugging frontend issues in Tauri desktop apps requires manually screenshotting, cropping, and describing what you see. Existing tools either hijack your cursor (xcap-based), render DOM to canvas (html2canvas — can't capture WebGL/video/canvas), or have no authentication.

## The Solution

Combine a bridge's knowledge of element positions (`getBoundingClientRect`) with real pixel screenshots (`import -window` + ImageMagick crop). No other tool does this.

```bash
# Screenshot a specific DOM element with real pixels
tauri-dev-tools screenshot --selector ".wf-toolbar" -o /tmp/toolbar.png
tauri-dev-tools screenshot --selector "#canvas-area" -o /tmp/canvas.png

# Explore DOM structure first
tauri-dev-tools dom --depth 3
tauri-dev-tools dom ".wf-canvas" --depth 4

# Then screenshot what you found
tauri-dev-tools screenshot --selector ".wf-canvas .block-node" -o /tmp/block.png
```

## Install

```bash
npm install -g tauri-dev-tools
```

**System requirements** (Linux):
- X11: `xdotool`, `imagemagick` (`sudo apt install xdotool imagemagick`)
- Wayland/Sway: `swaymsg`, `grim`, `imagemagick`

## Quick Start

### 1. Add the bridge to your Tauri app

See [rust-bridge/README.md](rust-bridge/README.md) for step-by-step integration (~120 lines of Rust).

The bridge runs a localhost-only, token-authenticated HTTP server during development. It auto-cleans up on exit.

### 2. Use the CLI

```bash
# DOM-targeted screenshot (needs bridge)
tauri-dev-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png
tauri-dev-tools screenshot --selector "#main-canvas" --max-width 800 -o /tmp/canvas.png

# Full window screenshot (no bridge needed, works with any window)
tauri-dev-tools screenshot --title "My App" -o /tmp/full.png

# Explore DOM
tauri-dev-tools dom --depth 3
tauri-dev-tools dom ".sidebar" --depth 2 --styles

# Evaluate JS
tauri-dev-tools eval "document.title"
tauri-dev-tools eval "document.querySelectorAll('.item').length"

# Wait for conditions
tauri-dev-tools wait --selector ".toast-message" --timeout 5000
tauri-dev-tools wait --title "My App" --timeout 10000

# Window info
tauri-dev-tools info --title "My App" --json
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
| `--depth <number>` | Max child depth (default: 3) |
| `--tree` | Compact tree view (default) |
| `--styles` | Include computed styles |
| `--count` | Just output match count |
| `--json` | Full structured JSON output |

### `eval`

Evaluate a JavaScript expression in the Tauri app.

```bash
tauri-dev-tools eval "document.title"
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
tauri-dev-tools info --title "My App" --json
```

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
| macOS | - | Planned |
| Windows | - | Planned |

## Safety Guarantees

- **No input injection** — no mouse moves, clicks, keystrokes, or cursor changes
- **No xcap crate** — uses `xdotool` + ImageMagick `import` (read-only X11 operations)
- **No daemon** — CLI runs and exits, no background processes
- **No `.mcp.json`** — never auto-starts
- **All OS interactions read-only** — `xdotool search`, `getwindowgeometry`, `import -window`
- **Token authenticated bridge** — random 32-char token, localhost-only
- **`execFile` (array args)** — never `exec` (shell string), prevents command injection
- **Window ID validated** — must match `/^\d+$/`

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
