# snapshot

Capture screenshot + DOM tree + page state + storage in one shot.

!!! note "Bridge Required"
    This command requires an active bridge connection and platform screenshot tools.

## Usage

```bash
tauri-agent-tools snapshot -o <prefix> [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <prefix>` | Output path prefix (e.g. `/tmp/debug`) | (required) |
| `-s, --selector <css>` | CSS selector to screenshot (full window if omitted) | — |
| `-t, --title <pattern>` | Window title (X11: regex; macOS/Wayland: substring); quote titles with spaces | auto-discover |
| `-w, --window-id <id>` | Platform window id (from `list-windows`) — overrides `--title` | — |
| `--dom-depth <number>` | DOM tree depth | `3` |
| `--eval <js>` | Additional JS to eval and save | — |
| `--json` | Output structured manifest | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

## Output Files

Given `-o /tmp/debug`, the command writes:

| File | Contents |
|------|----------|
| `/tmp/debug-screenshot.png` | Full window or element screenshot |
| `/tmp/debug-dom.json` | DOM tree serialized to depth |
| `/tmp/debug-page-state.json` | URL, title, viewport, scroll position, Tauri detection |
| `/tmp/debug-storage.json` | localStorage and sessionStorage contents |
| `/tmp/debug-eval.json` | Custom eval result (only if `--eval` is provided) |

## Examples

### Quick debug dump

```bash
tauri-agent-tools snapshot -o /tmp/debug
```

```
screenshot: /tmp/debug-screenshot.png
dom: /tmp/debug-dom.json
pageState: /tmp/debug-page-state.json
storage: /tmp/debug-storage.json
```

### Screenshot a specific element

```bash
tauri-agent-tools snapshot -o /tmp/toolbar -s ".toolbar"
```

### Include custom data

```bash
tauri-agent-tools snapshot -o /tmp/state --eval "JSON.stringify(window.__APP_STATE__)"
```

### JSON manifest for automation

```bash
tauri-agent-tools snapshot -o /tmp/snap --json
```

```json
{
  "screenshot": "/tmp/snap-screenshot.png",
  "dom": "/tmp/snap-dom.json",
  "pageState": "/tmp/snap-page-state.json",
  "storage": "/tmp/snap-storage.json"
}
```

## Error Handling

Each sub-step (screenshot, DOM, page state, storage, eval) is independent. If one fails, the others still run. Failed steps report an error string instead of a file path:

```json
{
  "screenshot": "/tmp/snap-screenshot.png",
  "dom": "error: Bridge error (500): Internal error",
  "pageState": "/tmp/snap-page-state.json",
  "storage": "/tmp/snap-storage.json"
}
```

`--dom-depth` must be a non-negative integer. Full-window PNG capture on macOS and Wayland needs only native capture tools; element crops and X11 capture also require ImageMagick. Platform prerequisites are checked before the snapshot starts. Use `capture` when other artifacts should still be collected despite missing screenshot tools.
