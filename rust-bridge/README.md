# Tauri Dev Bridge — Integration Guide

The dev bridge is a lightweight HTTP server that runs inside your Tauri app during development. It allows `tauri-agent-tools` to evaluate JavaScript in the webview for DOM-targeted screenshots and inspection.

## Quick Setup

### 1. Add dependencies to your `Cargo.toml`

```toml
[dependencies]
tiny_http = "0.12"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
scopeguard = "1"
rand = "0.8"
uuid = { version = "1", features = ["v4"] }
```

### 2. Copy the bridge module

Copy `examples/tauri-bridge/src/dev_bridge.rs` into your Tauri project's `src/` directory.

### 3. Wire up in main.rs

In your `main.rs`, register the bridge's Tauri command and start the bridge during setup:

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

> **Note:** If your app already uses `.invoke_handler()` with its own commands, merge them into one handler:
> ```rust
> builder = builder.invoke_handler(tauri::generate_handler![
>     your_command_one,
>     your_command_two,
>     dev_bridge::__dev_bridge_result,
> ]);
> ```
> Tauri only supports a single `invoke_handler` per builder — commands from multiple calls won't merge.

### 4. Use tauri-agent-tools

The bridge writes a token file to `/tmp/tauri-dev-bridge-<pid>.token` which `tauri-agent-tools` auto-discovers:

```bash
# Screenshot a specific element
tauri-agent-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png

# Explore the DOM
tauri-agent-tools dom --depth 3

# Evaluate JS
tauri-agent-tools eval "document.title"
```

## How It Works

1. Bridge starts an HTTP server on a random localhost port
2. A token file with `{ port, token, pid }` is written to `/tmp/`
3. `tauri-agent-tools` discovers the token file and authenticates via the token
4. Requests are `POST /eval { js, token }` — the bridge injects JS into the webview
5. The injected JS evaluates the expression, then calls back into Rust via `window.__TAURI__.core.invoke("__dev_bridge_result", { id, value })` to deliver the result
6. The HTTP handler thread waits for the result (up to 5 seconds) and returns it as JSON
7. The token file is cleaned up when the app exits

## Security

- **Localhost only** — the bridge binds to `127.0.0.1`
- **Token authenticated** — every request requires a random 32-char token
- **Development only** — wrapped in `cfg!(debug_assertions)`, stripped in release builds
- **Read-only** — `tauri-agent-tools` only reads DOM state, never injects input

## Agent-Assisted Setup

If you're using an AI coding agent (Claude Code, Codex, Cursor, etc.), the `tauri-bridge-setup` skill can guide automated setup. See `.agents/skills/tauri-bridge-setup/SKILL.md` or run:

```bash
cat "$(npm root -g)/tauri-agent-tools/.agents/skills/tauri-bridge-setup/SKILL.md"
```
