# ipc-monitor

Monitor Tauri IPC calls with temporary instrumentation.

!!! note "Bridge Required"
    This command requires an active bridge connection and a Tauri IPC invoke API in the webview.

## Usage

```bash
tauri-agent-tools ipc-monitor [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--filter <command>` | Only show specific IPC commands (supports `*` wildcards) | — |
| `--interval <ms>` | Poll interval in milliseconds | `500` |
| `--duration <ms>` | Auto-stop after N milliseconds | — |
| `--slow <ms>` | Flag calls taking at least this many milliseconds | — |
| `--stats` | Print per-command count, errors, maximum and average latency on stderr | — |
| `--json` | Output one JSON object per line | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

## Examples

### Monitor all IPC calls

```bash
tauri-agent-tools ipc-monitor
```

```
Monitoring IPC calls... (Ctrl+C to stop)
[12:34:56.789] 3ms get_config OK
[12:34:57.123] 15ms save_document OK
[12:34:57.456] 2ms check_updates OK
```

### Filter by command name

```bash
tauri-agent-tools ipc-monitor --filter "save_*"
```

### Auto-stop after 10 seconds

```bash
tauri-agent-tools ipc-monitor --duration 10000
```

### JSON output (one object per line)

```bash
tauri-agent-tools ipc-monitor --json --duration 5000
```

```json
{"command":"get_config","args":{},"timestamp":1710000000000,"duration":3,"result":{"theme":"dark"}}
{"command":"save_document","args":{"id":1},"timestamp":1710000001000,"duration":15,"result":"ok"}
```

### Fast polling

```bash
tauri-agent-tools ipc-monitor --interval 100 --duration 5000
```

## How It Works

1. Monkey-patches `window.__TAURI_INTERNALS__.invoke` to capture calls, falling back to `window.__TAURI__.core.invoke`
2. Logs command name, arguments, timing, and result/error
3. Polls the captured log at the specified interval
4. Restores the original `invoke` function on exit (Ctrl+C or `--duration`)

## Notes

- The wrapper temporarily replaces the invoke function and preserves application results and exceptions; internal bridge result callbacks are excluded
- If neither invoke API is found, the command reports an error
- Cleanup happens automatically on SIGINT/SIGTERM or when `--duration` expires

Each invocation has an independent session with a 1,000-entry buffer. Overflow is reported on stderr. The collector takes a final sample even when `--duration` is shorter than `--interval`, and removes its own instrumentation on completion, failure, SIGINT, or SIGTERM while the webview remains reachable. Force-killing the CLI or losing the webview can prevent cleanup. Intervals and durations must be positive whole milliseconds.

Use `--duration` in automation. With `--json`, entries are NDJSON on stdout; warnings and fatal errors go to stderr.
