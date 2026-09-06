# eval

Evaluate a JavaScript expression in the Tauri app's webview.

!!! note "Bridge Required"
    This command requires an active bridge connection.

## Usage

```bash
tauri-agent-tools eval [expression] [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `[expression]` | JavaScript expression; choose this or `--file` | — |
| `--file <path>` | Read JavaScript from a file | — |
| `--json` | Output `{ "result": value }` with the evaluated value | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

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
- JavaScript runs in the selected webview’s global context and can modify application state
- Promises are awaited; thrown exceptions fail the command, while a literal string beginning with `ERROR:` remains a successful result
- `--json` returns typed JSON values; undefined becomes null, and top-level BigInts, symbols, functions, and non-finite numbers become strings
- Fatal errors use the shared JSON error envelope on stderr when `--json` is supplied

## Structured and file-based evaluation

```bash
tauri-agent-tools eval 'Promise.resolve({ready: true})' --json
# { "result": { "ready": true } }
tauri-agent-tools eval --file inspect.js --window-label settings --json
```

Supply either an expression or `--file`, not both.
