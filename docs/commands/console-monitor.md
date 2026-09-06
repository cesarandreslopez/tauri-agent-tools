# console-monitor

Monitor console output (log/warn/error/info/debug) in real-time.

!!! note "Bridge Required"
    This command requires an active bridge connection.

## Usage

```bash
tauri-agent-tools console-monitor [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--level <level>` | Filter by level: `log`, `warn`, `error`, `info`, `debug` | — |
| `--filter <regex>` | Filter messages by regex pattern | — |
| `--interval <ms>` | Poll interval in milliseconds | `500` |
| `--duration <ms>` | Auto-stop after N milliseconds | — |
| `--json` | Output one JSON object per line | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

## Examples

### Monitor all console output

```bash
tauri-agent-tools console-monitor
```

```
Monitoring console output... (Ctrl+C to stop)
[12:34:56.789] [LOG] App initialized
[12:34:57.123] [WARN] Deprecated API usage
[12:34:57.456] [ERROR] Failed to fetch data
```

### Only show errors

```bash
tauri-agent-tools console-monitor --level error
```

### Filter by regex pattern

```bash
tauri-agent-tools console-monitor --filter "fetch|network"
```

### Auto-stop after 30 seconds

```bash
tauri-agent-tools console-monitor --duration 30000 --level warn
```

### JSON output

```bash
tauri-agent-tools console-monitor --json --duration 5000
```

```json
{"level":"log","message":"App initialized","timestamp":1710000000000}
{"level":"error","message":"Failed to fetch data","timestamp":1710000001000}
```

## How It Works

1. Monkey-patches `console.log`, `console.warn`, `console.error`, `console.info`, `console.debug`
2. Captures message text and timestamp while passing through to original console methods
3. Polls the captured log at the specified interval
4. Restores original console methods on exit

## Notes

- Original console methods still execute — the patch is transparent
- Object arguments are serialized with bounded traversal; circular references and BigInts are safe, and getters/custom `toJSON` methods are not invoked
- Cleanup happens automatically on SIGINT/SIGTERM or when `--duration` expires

Each invocation has an independent session with a 1,000-entry buffer. Overflow is reported on stderr. The collector takes a final sample even when `--duration` is shorter than `--interval`, and removes its own instrumentation on completion, failure, SIGINT, or SIGTERM while the webview remains reachable. Force-killing the CLI or losing the webview can prevent cleanup. Intervals and durations must be positive whole milliseconds.

Use `--duration` in automation. With `--json`, entries are NDJSON on stdout; warnings and fatal errors go to stderr.
