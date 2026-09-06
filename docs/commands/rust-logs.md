# rust-logs

Monitor Rust backend logs and sidecar output in real-time.

!!! note "Bridge Required"
    This command requires an active bridge connection with the updated `dev_bridge.rs` that supports the `/logs` endpoint.

## Usage

```bash
tauri-agent-tools rust-logs [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--level <level>` | Minimum log level: `trace`, `debug`, `info`, `warn`, `error` | — |
| `--target <regex>` | Filter by Rust module path (regex) | — |
| `--source <source>` | Filter by source: `rust`, `sidecar`, `all`, or `sidecar:<name>` | `all` |
| `--filter <regex>` | Filter messages by regex pattern | — |
| `--interval <ms>` | Poll interval in milliseconds | `500` |
| `--duration <ms>` | Auto-stop after N milliseconds | — |
| `--json` | Output one JSON object per line | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

## Examples

### Monitor all Rust logs

```bash
tauri-agent-tools rust-logs
```

```
Monitoring Rust logs... (Ctrl+C to stop)
[12:34:56.789] [INFO] myapp::db: Connected to database
[12:34:57.123] [WARN] myapp::api: Rate limit approaching
[12:34:57.456] [ERROR] myapp::auth: Token expired for user 42
```

### Only show warnings and errors

```bash
tauri-agent-tools rust-logs --level warn
```

Level filtering is severity-based (like `RUST_LOG`): `--level warn` shows `warn` and `error`, filtering out `trace`, `debug`, and `info`.

### Filter by module path

```bash
tauri-agent-tools rust-logs --target "myapp::db"
```

The `--target` option accepts a regex, so `myapp::db` matches `myapp::db`, `myapp::db::pool`, etc.

### Monitor sidecar output only

```bash
tauri-agent-tools rust-logs --source sidecar
```

Or filter to a specific sidecar:

```bash
tauri-agent-tools rust-logs --source sidecar:ffmpeg
```

### Auto-stop after 30 seconds

```bash
tauri-agent-tools rust-logs --duration 30000 --level info
```

### JSON output

```bash
tauri-agent-tools rust-logs --json --duration 5000
```

```json
{"timestamp":1710000000000,"level":"info","target":"myapp::db","message":"Connected to database","source":"rust"}
{"timestamp":1710000001000,"level":"warn","target":"stderr","message":"deprecated flag used","source":"sidecar:ffmpeg"}
```

## How It Works

Unlike `console-monitor` which injects JavaScript to capture console output, `rust-logs` reads from a server-side log buffer:

1. The bridge's `BridgeLogLayer` captures `tracing` events into a ring buffer (max 1000 entries)
2. Sidecar processes spawned via `spawn_sidecar_monitored()` pipe stdout/stderr into the same buffer
3. The CLI polls `POST /logs` with its own cursor on bridge v0.8+, starting at cursor 0 to include the retained backlog; older bridges fall back to draining with a one-time warning
4. Entries are filtered client-side by level, target, source, and text pattern

## Output Format

**Rust logs:**
```
[HH:MM:SS.mmm] [LEVEL] target: message
```

**Sidecar logs:**
```
[HH:MM:SS.mmm] [LEVEL] [sidecar:name] target: message
```

## Notes

- Level filtering is **severity-based**: `--level warn` shows warn AND error (unlike `console-monitor` which does exact match)
- The log buffer holds up to 1000 entries between polls — if your app produces more, increase poll frequency with `--interval`
- No cleanup is needed on exit (unlike `console-monitor`, there are no JavaScript patches to undo)
- If the bridge doesn't support `/logs` (old version), you'll get a clear error asking you to update `dev_bridge.rs`

`rust-logs`, `logs`, and `capture` use independent cursors on bridge v0.8+, so concurrent readers receive the same retained entries. Evicted entries produce a dropped-entry warning. On older bridges, drain reads consume entries for other readers.

The monitor takes a final sample when its duration expires or it receives SIGINT/SIGTERM, including durations shorter than the polling interval. Use positive whole milliseconds for both options.
