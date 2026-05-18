# eval

Evaluate a JavaScript expression in the Tauri app's webview.

!!! note "Bridge Required"
    This command requires an active bridge connection.

## Usage

```bash
tauri-agent-tools eval <expression> [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `<expression>` | JavaScript expression to evaluate (required) | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |

## Examples

### Get document title

```bash
tauri-agent-tools eval "document.title"
```

```
My Tauri App
```

### Count elements

```bash
tauri-agent-tools eval "document.querySelectorAll('.item').length"
```

```
42
```

### Get structured data

```bash
tauri-agent-tools eval "JSON.stringify({url: location.href, ready: document.readyState})"
```

```json
{
  "url": "http://localhost:1420/",
  "ready": "complete"
}
```

### Check Tauri API availability

```bash
tauri-agent-tools eval "!!(window.__TAURI_INTERNALS__ || window.__TAURI__)"
```

```
true
```

### Get computed style value

```bash
tauri-agent-tools eval "getComputedStyle(document.querySelector('.btn')).backgroundColor"
```

## Notes

- The expression runs in the webview's JavaScript context
- Results that look like JSON are automatically pretty-printed
- The bridge has a 5-second timeout per evaluation
- This is a read-only tool — use it to inspect state, not modify it
