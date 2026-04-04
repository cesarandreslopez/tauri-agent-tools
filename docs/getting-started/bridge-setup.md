# Bridge Setup

The dev bridge is a lightweight HTTP server that runs inside your Tauri app during development. It allows tauri-agent-tools to evaluate JavaScript in the webview for DOM-targeted screenshots and inspection.

## Setup Steps

### 1. Add dependencies

Add to your Tauri project's `Cargo.toml`:

```toml
[dependencies]
tiny_http = "0.12"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
scopeguard = "1"
rand = "0.8"
uuid = { version = "1", features = ["v4"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["registry"] }
```

### 2. Copy the bridge module

Copy `examples/tauri-bridge/src/dev_bridge.rs` from the tauri-agent-tools package into your Tauri project's `src/` directory:

```bash
cp "$(npm root -g)/tauri-agent-tools/examples/tauri-bridge/src/dev_bridge.rs" src/
```

### 3. Wire into main.rs

Register the bridge's Tauri command and start the bridge during setup:

```rust
mod dev_bridge;

fn main() {
    let mut builder = tauri::Builder::default();

    if cfg!(debug_assertions) {
        builder = builder.invoke_handler(tauri::generate_handler![
            dev_bridge::__dev_bridge_result
        ]);
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                if let Err(e) = dev_bridge::start_bridge(app.handle()).map(|_| ()) {
                    eprintln!("Warning: Failed to start dev bridge: {e}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

!!! note "Merging with existing commands"
    If your app already uses `.invoke_handler()`, merge the bridge command into it:
    ```rust
    builder = builder.invoke_handler(tauri::generate_handler![
        your_command_one,
        your_command_two,
        dev_bridge::__dev_bridge_result,
    ]);
    ```
    Tauri only supports a single `invoke_handler` per builder.

### 4. Verify

Start your Tauri app in dev mode, then:

```bash
tauri-agent-tools probe --json
tauri-agent-tools dom --depth 2
```

## How It Works

```mermaid
sequenceDiagram
    participant CLI as tauri-agent-tools
    participant FS as /tmp/
    participant Bridge as Rust Bridge
    participant WV as Webview

    Bridge->>FS: Write token file (port, token, pid)
    CLI->>FS: Scan tauri-dev-bridge-*.token
    CLI->>CLI: Check PID liveness
    CLI->>Bridge: POST /eval {js, token}
    Bridge->>WV: eval(wrapped JS with callback)
    WV->>WV: Evaluate expression
    WV->>Bridge: __TAURI__.core.invoke("__dev_bridge_result", {id, value})
    Bridge-->>CLI: {result}
```

1. Bridge starts an HTTP server on a random localhost port
2. A token file with `{ port, token, pid }` is written to `/tmp/`
3. `tauri-agent-tools` discovers the token file and authenticates via the token
4. Requests are `POST /eval { js, token }` — the bridge injects JS into the webview
5. The injected JS evaluates the expression, then calls back into Rust via `window.__TAURI__.core.invoke()` to deliver the result
6. The HTTP handler waits for the result (up to 5 seconds) and returns it as JSON
7. The token file is cleaned up when the app exits (via `scopeguard`)

## Security

- **Localhost only** — the bridge binds to `127.0.0.1`
- **Token authenticated** — every request requires a random 32-character token
- **Development only** — wrapped in `cfg!(debug_assertions)`, stripped in release builds
- **Inspection is read-only** — inspection commands only read DOM state
- **Interaction is debug-only** — interaction commands use eval-based DOM dispatch, sandboxed to the webview

## Troubleshooting

### "No bridge found"

The CLI couldn't find a token file in `/tmp/`. Check:

- Is the Tauri app running in **dev mode** (`cargo tauri dev`)?
- Is `dev_bridge::start_bridge()` being called in `.setup()`?
- Is `cfg!(debug_assertions)` true (dev mode, not release)?
- Check for token files: `ls /tmp/tauri-dev-bridge-*.token`

### Stale token files

If the Tauri app crashes without cleanup, stale token files may remain. The CLI automatically detects these by checking PID liveness and removes them. You can also clean up manually:

```bash
rm /tmp/tauri-dev-bridge-*.token
```

### Port conflicts

The bridge binds to a random port. If you need a specific port, modify `dev_bridge.rs` to use a fixed port. The CLI supports `--port` and `--token` flags to connect to a specific bridge:

```bash
tauri-agent-tools dom --port 9876 --token your-token
```

## Log Capture

The bridge automatically captures Rust `tracing` log events. To also capture sidecar process output, use `spawn_sidecar_monitored()`:

```rust
if cfg!(debug_assertions) {
    let (port, log_buffer) = dev_bridge::start_bridge(app.handle())?;

    // Spawn a sidecar with monitored output
    dev_bridge::spawn_sidecar_monitored(
        "ffmpeg",
        "ffmpeg",
        &["-i", "input.mp4", "-f", "null", "-"],
        &log_buffer,
    )?;
}
```

Then use `tauri-agent-tools rust-logs` to view the captured output:

```bash
# All Rust logs and sidecar output
tauri-agent-tools rust-logs --duration 10000

# Only sidecar output
tauri-agent-tools rust-logs --source sidecar --duration 10000

# Only warnings and errors
tauri-agent-tools rust-logs --level warn
```

If you already have a `tracing` subscriber, use `create_log_layer()` instead:

```rust
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

let log_buffer = std::sync::Arc::new(dev_bridge::LogBuffer::new());
tracing_subscriber::registry()
    .with(dev_bridge::create_log_layer(log_buffer.clone()))
    .with(tracing_subscriber::fmt::layer())
    .init();
```

## Agent-Assisted Setup

If you're using an AI coding agent (Claude Code, Codex, Cursor, etc.), the `tauri-bridge-setup` skill can guide automated setup. See `.agents/skills/tauri-bridge-setup/SKILL.md`.
