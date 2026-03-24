# screenshot

Capture a screenshot of a window or DOM element.

!!! info "Bridge"
    Bridge required only when using `--selector`. Full window screenshots (`--title` only) work without a bridge.

## Usage

```bash
tauri-agent-tools screenshot [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --selector <css>` | CSS selector — screenshot just this element (requires bridge) | — |
| `-t, --title <regex>` | Window title to match (auto-discovered from bridge if omitted) | — |
| `-o, --output <path>` | Output file path | `screenshot-<timestamp>.png` |
| `--format <png\|jpg>` | Output format | `png` |
| `--max-width <number>` | Resize to max width (preserves aspect ratio) | — |
| `--json` | Output structured JSON metadata | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |

## Examples

### Full window screenshot

```bash
tauri-agent-tools screenshot --title "My App" -o /tmp/full.png
```

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
  "windowTitle": null
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

When only `--title` is used, the full window is captured directly without cropping.

## Tips

- Use `dom --depth 2` first to find the right CSS selector
- The `--max-width` flag is useful for keeping screenshots manageable for AI agents
- Without `--title`, the tool auto-discovers the window title from the bridge via `document.title`
