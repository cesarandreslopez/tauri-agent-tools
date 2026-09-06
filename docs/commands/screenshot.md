# screenshot

Capture a screenshot of a window or DOM element.

!!! info "Bridge"
    Bridge required only when using `--selector`. Full window screenshots (`--title` or `--window-id`) work without a bridge.

## Usage

```bash
tauri-agent-tools screenshot [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --selector <css>` | CSS selector — screenshot just this element (requires bridge) | — |
| `-t, --title <pattern>` | Window title (X11: regex; macOS/Wayland: substring); quote titles with spaces (auto-discovered from bridge if omitted) | — |
| `-w, --window-id <id>` | Platform window id (from `list-windows`) — overrides `--title` | — |
| `-o, --output <path>` | Output file path | `screenshot-<timestamp>.png` |
| `--format <png\|jpg>` | Output format | `png` |
| `--max-width <number>` | Resize to max width (preserves aspect ratio) | — |
| `--json` | Output structured JSON metadata | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

## Examples

### Full window screenshot

```bash
tauri-agent-tools screenshot --title "My App" -o /tmp/full.png
```

### Screenshot by window id

```bash
tauri-agent-tools screenshot --window-id 12345678 -o /tmp/full.png
```

Get the id from `list-windows --json` (the `windowId` field). No shell-quoting risk (ids have no spaces), and it works for windows a title regex can't uniquely or reliably match.

### DOM element screenshot

```bash
tauri-agent-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png
```

### Resized element screenshot

```bash
tauri-agent-tools screenshot --selector "#canvas" --max-width 800 -o /tmp/canvas.png
```

### JSON metadata output

```bash
tauri-agent-tools screenshot --selector ".header" -o /tmp/header.png --json
```

```json
{
  "path": "/tmp/header.png",
  "format": "png",
  "size": 45231,
  "selector": ".header",
  "windowTitle": null,
  "windowId": "12345678"
}
```

### JPEG format

```bash
tauri-agent-tools screenshot --title "My App" --format jpg -o /tmp/window.jpg
```

## How It Works

When `--selector` is used:

1. Bridge evaluates `getBoundingClientRect()` for the CSS selector
2. Bridge reports viewport size (`window.innerWidth/innerHeight`)
3. Platform adapter captures the full window
4. Crop region is computed: element rect + decoration offset (title bar, borders)
5. ImageMagick crops to the element bounds
6. Optional resize with `--max-width`

When only `--title` or `--window-id` is used, the full window is captured directly without cropping.

## Tips

- Use `dom --depth 2` first to find the right CSS selector
- The `--max-width` flag is useful for keeping screenshots manageable for AI agents
- With `--selector` and no `--title` or `--window-id`, the tool auto-discovers the title from the bridge via `document.title`
- Window id format is platform-specific (X11/macOS/Sway numeric, Hyprland hex `0x…`) — always take it from `list-windows` output
- `--window-id` (platform/OS window) is unrelated to `--window-label` (Tauri webview label, a bridge concept)

Choose `--selector`, `--title`, or `--window-id`. Title auto-discovery is available with `--selector`. `--max-width` must be a positive integer. Full-window PNG capture on macOS and Wayland uses native tools without ImageMagick; selector crops, resizing, JPEG output, and X11 capture require ImageMagick.
