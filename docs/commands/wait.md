# wait

Wait for a condition to be met.

!!! info "Bridge"
    Bridge required for `--selector` and `--eval`. The `--title` mode works without a bridge.

## Usage

```bash
tauri-agent-tools wait [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --selector <css>` | Wait for CSS selector to match an element | — |
| `-e, --eval <js>` | Wait for JS expression to be truthy | — |
| `-t, --title <pattern>` | Wait for window with title (no bridge needed) | — |
| `--timeout <ms>` | Maximum wait time in milliseconds | `10000` |
| `--interval <ms>` | Polling interval in milliseconds | `500` |
| `--json` | Output the match mode, target/result, and elapsed time | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

Choose exactly one of `--selector`, `--eval`, or `--title`. Timeouts and intervals must be positive whole milliseconds (maximum 2147483647).

## Examples

### Wait for a DOM element

```bash
tauri-agent-tools wait --selector ".toast-message" --timeout 5000
```

```
found
```

### Wait for a window to appear

```bash
tauri-agent-tools wait --title "My App" --timeout 10000
```

Outputs the window ID when found.

### Wait for a JS condition

```bash
tauri-agent-tools wait --eval "document.readyState === 'complete'" --timeout 5000
```

### Custom polling interval

```bash
tauri-agent-tools wait --selector ".loading-done" --interval 200 --timeout 30000
```

## Behavior

- **`--selector`**: polls `document.querySelector()` until a matching element exists
- **`--eval`**: polls the JS expression until it returns a truthy value
- **`--title`**: polls the platform adapter's `findWindow()` until a matching window appears
- Throws an error if the condition is not met within `--timeout`
- Exits with code 0 on success, non-zero on timeout

Promises are awaited and JavaScript truthiness is evaluated before serialization: `false`, `0`, `null`, and `undefined` keep waiting; the string `"false"` is truthy. Invalid selectors and thrown expressions fail immediately. Each poll and sleep consumes the same overall timeout budget.

Title matching uses regex on X11 and substrings on macOS/Sway/Hyprland. `wait --title` does not require ImageMagick. JSON results for eval mode retain the historical bridge-serialized `result` field; use `eval --json` when a typed value is needed.
