---
name: tauri-bridge-setup
description: How to add the tauri-agent-tools Rust dev bridge to a Tauri application
version: 0.7.0
tags: [tauri, rust, bridge, setup, integration, multi-window, process-tree, capabilities, devtools, health]
---

# Tauri Dev Bridge Setup

Add the dev bridge to a Tauri app so `tauri-agent-tools` can inspect DOM, evaluate JS, monitor IPC, take element screenshots, and interact with the UI. Bridge v0.7 also exposes process tree, capability audit, devtools URL, and health endpoints.

The bridge runs **only in debug builds** and is stripped from release builds automatically.

## Re-copying for v0.7

> **Upgrading from v0.6:** The bridge surface grew with four new endpoints (`/process`, `/capabilities`, `/devtools`, `/health`) and `start_bridge` now returns a third tuple element (the sidecar registry). **Re-copy `dev_bridge.rs` from the latest `examples/tauri-bridge/src/dev_bridge.rs`** and adjust your `main.rs` to destructure the new return shape (see Step 3 below). The CLI's new commands (`process-tree`, `capabilities audit`, `webview attach`, `health`) feature-detect via `GET /version` and emit a clear "requires v0.7.0+" error when the bridge is older — so partial upgrades fail loudly rather than silently.

## Bridge Endpoints

The bridge exposes eight HTTP endpoints on a random localhost port:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/eval` | POST | token | Evaluate JS in a webview (supports `window` param for multi-window) |
| `/logs` | POST | token | Drain Rust tracing logs and sidecar output |
| `/describe` | POST | token | Report PID, window labels, and capabilities |
| `/version` | GET | none | Bridge version and available endpoints (used for feature detection) |
| `/process` | POST | token | Tauri PID + registered sidecars (powers `process-tree`) — **v0.7+** |
| `/capabilities` | POST | token | Declared Tauri capability set + live window labels (powers `capabilities audit`) — **v0.7+** |
| `/devtools` | POST | token | Webview inspector URL or platform hint (powers `webview attach`) — **v0.7+** |
| `/health` | POST | token | Uptime + webview readiness + sidecar liveness (powers `health`) — **v0.7+** |

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

[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

(`libc` is used for the cheap `kill(pid, 0)` aliveness probe powering `/process` and `/health` sidecar reporting. Windows is supported but skips the liveness check in v0.7.)

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
                // start_bridge returns (port, LogBuffer, SidecarRegistry).
                // Hold onto the registry if you plan to spawn sidecars; otherwise
                // the bound `let _` keeps it alive for the app's lifetime.
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

## Optional: Sidecar Log Capture + Process Visibility

To capture stdout/stderr from sidecar processes (external binaries) AND have them show up in `process-tree`/`health`, use `spawn_sidecar_monitored()` and pass the registry returned by `start_bridge`:

```rust
if cfg!(debug_assertions) {
    let (_port, log_buffer, sidecar_registry) = dev_bridge::start_bridge(app.handle())?;

    // Spawn a sidecar with monitored output AND registry tracking
    dev_bridge::spawn_sidecar_monitored(
        "ffmpeg",                                     // name (source: "sidecar:ffmpeg")
        "ffmpeg",                                     // command
        &["-i", "input.mp4", "-f", "null", "-"],      // args
        &log_buffer,
        Some(&sidecar_registry),                      // register for /process + /health
    )?;
}
```

Pass `None` for the registry argument to opt out of process tracking (useful for ephemeral one-shot helpers).

If you spawn children with your own mechanism, register them after the fact so they appear in `process-tree`:

```rust
let child = my_own_spawn(...)?;
dev_bridge::register_sidecar(
    &sidecar_registry,
    "my-helper",
    child.id(),
    Some("/path/to/binary".to_string()),
    vec!["--mode=watch".to_string()],
);
```

Then monitor with: `tauri-agent-tools rust-logs --source sidecar --duration 10000`, view the tree with `tauri-agent-tools process-tree`, and check liveness with `tauri-agent-tools health`.

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
