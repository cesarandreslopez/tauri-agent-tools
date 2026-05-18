# page-state

Query webview page state: URL, title, viewport, scroll position, document size, and Tauri detection.

!!! note "Bridge Required"
    This command requires an active bridge connection.

## Usage

```bash
tauri-agent-tools page-state [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output as JSON | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |

## Examples

### Text output

```bash
tauri-agent-tools page-state
```

```
URL:             http://localhost:1420/
Title:           My Tauri App
Viewport:        1920x1080
Scroll Position: 0, 0
Document Size:   1920x2400
Tauri:           yes
```

### JSON output

```bash
tauri-agent-tools page-state --json
```

```json
{
  "url": "http://localhost:1420/",
  "title": "My Tauri App",
  "viewport": { "width": 1920, "height": 1080 },
  "scroll": { "x": 0, "y": 0 },
  "document": { "width": 1920, "height": 2400 },
  "hasTauri": true
}
```

## Notes

- `viewport` shows `window.innerWidth` / `window.innerHeight`
- `document` shows `document.documentElement.scrollWidth` / `scrollHeight`
- `hasTauri` indicates whether Tauri's internal or global API is present in the webview
- Useful for checking the webview state before taking screenshots or running other commands
