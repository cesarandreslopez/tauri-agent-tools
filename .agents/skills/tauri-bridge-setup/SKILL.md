---
name: tauri-bridge-setup
description: How to add the tauri-agent-tools Rust dev bridge to a Tauri application
version: 0.2.0
tags: [tauri, rust, bridge, setup, integration]
---

# Tauri Dev Bridge Setup

Add the dev bridge to a Tauri app so `tauri-agent-tools` can inspect DOM, evaluate JS, monitor IPC, and take element screenshots.

The bridge runs **only in debug builds** and is stripped from release builds automatically.

## Step 1 — Add Cargo dependencies

Add to your Tauri app's `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tiny_http = "0.12"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
scopeguard = "1"
rand = "0.8"
uuid = { version = "1", features = ["v4"] }
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
                if let Err(e) = dev_bridge::start_bridge(app.handle()) {
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
# Should show your app with a bridge indicator
tauri-agent-tools list-windows --tauri

# Should return DOM tree
tauri-agent-tools dom --depth 2
```

Both commands succeeding confirms the bridge is working.

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
