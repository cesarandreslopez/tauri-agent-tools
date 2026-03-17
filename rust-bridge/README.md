# Tauri Dev Bridge — Integration Guide

The dev bridge is a lightweight HTTP server that runs inside your Tauri app during development. It allows `tauri-dev-tools` to evaluate JavaScript in the webview for DOM-targeted screenshots and inspection.

## Quick Setup

### 1. Add dependencies to your `Cargo.toml`

```toml
[dependencies]
tiny_http = "0.12"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
scopeguard = "1"
rand = "0.8"
```

### 2. Copy the bridge module

Copy `examples/tauri-bridge/src/dev_bridge.rs` into your Tauri project's `src/` directory.

### 3. Start the bridge in your app

In your `main.rs` or app setup:

```rust
mod dev_bridge;

fn main() {
    tauri::Builder::default()
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

### 4. Use tauri-dev-tools

The bridge writes a token file to `/tmp/tauri-dev-bridge-<pid>.token` which `tauri-dev-tools` auto-discovers:

```bash
# Screenshot a specific element
tauri-dev-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png

# Explore the DOM
tauri-dev-tools dom --depth 3

# Evaluate JS
tauri-dev-tools eval "document.title"
```

## How It Works

1. Bridge starts an HTTP server on a random localhost port
2. A token file with `{ port, token, pid }` is written to `/tmp/`
3. `tauri-dev-tools` discovers the token file and authenticates via the token
4. Requests are `POST /eval { js, token }` — the bridge evaluates JS in the webview
5. The token file is cleaned up when the app exits

## Security

- **Localhost only** — the bridge binds to `127.0.0.1`
- **Token authenticated** — every request requires a random 32-char token
- **Development only** — wrapped in `cfg!(debug_assertions)`, stripped in release builds
- **Read-only** — `tauri-dev-tools` only reads DOM state, never injects input
