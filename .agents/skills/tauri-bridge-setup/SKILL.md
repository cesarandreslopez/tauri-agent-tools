---
name: tauri-bridge-setup
description: How to add the tauri-agent-tools Rust dev bridge to a Tauri application
version: 0.6.0
tags: [tauri, rust, bridge, setup, integration, multi-window]
---

# Tauri Dev Bridge Setup

Add the dev bridge to a Tauri app so `tauri-agent-tools` can inspect DOM, evaluate JS, monitor IPC, take element screenshots, and interact with the UI.

The bridge runs **only in debug builds** and is stripped from release builds automatically.

## Bridge Endpoints

The bridge exposes four HTTP endpoints on a random localhost port:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/eval` | POST | token | Evaluate JS in a webview (supports `window` param for multi-window) |
| `/logs` | POST | token | Drain Rust tracing logs and sidecar output |
| `/describe` | POST | token | Report PID, window labels, and capabilities |
| `/version` | GET | none | Bridge version and available endpoints |

## Step 1 — Add Cargo dependencies

Add to your Tauri app's `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tiny_http = "0.12"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
scopeguard = "1"
rand = "0.8"
uuid = { version = "1", features = ["v4"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["registry"] }
```

## Step 2 — Copy the bridge module

Copy `dev_bridge.rs` from the tauri-agent-tools package into your project:

```bash
# Find the installed package location
TOOLS_DIR=$(npm root -g)/tauri-agent-tools

# Copy the bridge module
cp "$TOOLS_DIR/examples/tauri-bridge/src/dev_bridge.rs" src-tauri/src/dev_bridge.rs
```

If installed locally (not globally):

```bash
cp node_modules/tauri-agent-tools/examples/tauri-bridge/src/dev_bridge.rs src-tauri/src/dev_bridge.rs
```

## Step 3 — Wire up in main.rs

Add the module declaration, register the bridge command, and start the bridge in your `src-tauri/src/main.rs`:

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

If you already have an `.invoke_handler()` with your own commands, merge them into one handler:

```rust
builder = builder.invoke_handler(tauri::generate_handler![
    your_command_one,
    your_command_two,
    dev_bridge::__dev_bridge_result,
]);
```

If you already have a `.setup()` call, add the `if cfg!(debug_assertions) { ... }` block inside it.

## Step 4 — Verify

Build and run the Tauri app in dev mode, then:

```bash
# Discover the bridge and check health
tauri-agent-tools probe --json

# Should return DOM tree
tauri-agent-tools dom --depth 2
```

Both commands succeeding confirms the bridge is working. The `probe` output shows bridge version, available endpoints, window labels, and PID.

## Multi-Window Apps

The bridge supports evaluating JS in any named webview window. The `/eval` endpoint accepts an optional `window` field (defaults to `"main"`). The `/describe` endpoint reports all registered window labels.

From the CLI, use `--window-label` to target a specific window:

```bash
# Eval in a secondary window
tauri-agent-tools eval "document.title" --window-label overlay --json

# Screenshot a specific window's element
tauri-agent-tools screenshot --selector ".content" --window-label settings -o /tmp/settings.png
```

Use `probe` to discover available windows:

```bash
tauri-agent-tools probe --json
# → { "bridges": [{ "windows": ["main", "overlay", "settings"], ... }] }
```

## Optional: Sidecar Log Capture

To capture stdout/stderr from sidecar processes (external binaries), use `spawn_sidecar_monitored()`:

```rust
if cfg!(debug_assertions) {
    let (_port, log_buffer) = dev_bridge::start_bridge(app.handle())?;

    // Spawn a sidecar with monitored output
    dev_bridge::spawn_sidecar_monitored(
        "ffmpeg",           // name (appears as source: "sidecar:ffmpeg")
        "ffmpeg",           // command
        &["-i", "input.mp4", "-f", "null", "-"],  // args
        &log_buffer,
    )?;
}
```

Then monitor with: `tauri-agent-tools rust-logs --source sidecar --duration 10000`

## Troubleshooting

**"No bridge found" error:**
- Is the app running in dev/debug mode? The bridge only starts when `cfg!(debug_assertions)` is true.
- Check for token files: `ls /tmp/tauri-dev-bridge-*.token`
- The app process must be running — the bridge starts during `setup()`.

**Stale token files:**
- If the app crashed without cleanup, old token files may remain: `rm /tmp/tauri-dev-bridge-*.token`
- Restart the Tauri app after cleaning.

**Port conflicts:**
- The bridge picks a random port. If it fails, check the app's stderr for "Failed to start dev bridge".
- Ensure no firewall blocks localhost connections.

**Multi-window eval fails:**
- Verify the window label matches exactly (case-sensitive). Use `probe --json` to list available labels.
- The default label is `"main"` — omit `--window-label` to target it.
