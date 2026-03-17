# Bridge Protocol

The bridge is a lightweight HTTP server embedded in the Tauri app during development. It enables tauri-agent-tools to evaluate JavaScript in the webview.

## Protocol Specification

### Endpoint

```
POST http://127.0.0.1:{port}/eval
```

### Request

```json
{
  "js": "document.title",
  "token": "a1b2c3d4e5f6..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `js` | string | JavaScript expression to evaluate in the webview |
| `token` | string | 32-character authentication token |

### Response

**Success (200):**

```json
{
  "result": "My Tauri App"
}
```

**Authentication error (401/403):**

```
Bridge authentication failed — check your token
```

**Bad request (400):**

```
Missing 'js' field
```

## Communication Flow

```mermaid
sequenceDiagram
    participant CLI as tauri-agent-tools
    participant FS as /tmp/
    participant Bridge as Rust Bridge<br/>(tiny_http)
    participant WV as Tauri Webview

    Note over Bridge: App startup
    Bridge->>Bridge: Generate random token
    Bridge->>Bridge: Bind to 127.0.0.1:0 (random port)
    Bridge->>FS: Write tauri-dev-bridge-{pid}.token<br/>{port, token, pid}

    Note over CLI: Command execution
    CLI->>FS: Scan tauri-dev-bridge-*.token
    CLI->>CLI: Parse JSON, check PID liveness
    CLI->>CLI: Clean stale files from dead processes

    CLI->>Bridge: POST /eval {js, token}
    Bridge->>Bridge: Validate token
    Bridge->>Bridge: Generate UUID request ID
    Bridge->>WV: eval(wrapped JS with callback)
    WV->>WV: Evaluate expression
    WV->>Bridge: __TAURI__.core.invoke("__dev_bridge_result", {id, value})
    Bridge->>Bridge: Match result by ID, unblock HTTP thread
    Bridge-->>CLI: {result: ...}

    Note over Bridge: App shutdown
    Bridge->>FS: Delete token file (scopeguard)
```

## Token File Format

Token files are written to the system temp directory (`/tmp/` on Linux/macOS):

**Filename:** `tauri-dev-bridge-{pid}.token`

**Contents:**

```json
{
  "port": 54321,
  "token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "pid": 12345
}
```

| Field | Type | Description |
|-------|------|-------------|
| `port` | number | HTTP server port |
| `token` | string | 32-character random authentication token |
| `pid` | number | Process ID of the Tauri app |

## Authentication

- Every request must include the `token` field matching the generated token
- Token is a random 32-character alphanumeric string
- Mismatched tokens return HTTP 401/403

## Security Properties

- **Localhost only** — bridge binds to `127.0.0.1`, not `0.0.0.0`
- **Random port** — no fixed port to target
- **Token auth** — prevents unauthorized access from other local processes
- **Debug only** — wrapped in `cfg!(debug_assertions)`, compiled out of release builds
- **Cleanup** — token file deleted on exit via `scopeguard`
- **Read-only** — the CLI only evaluates JS, never injects input events

## Error Handling

| HTTP Status | Meaning | CLI Behavior |
|-------------|---------|-------------|
| 200 | Success | Parse and return result |
| 401/403 | Token mismatch | Throw "authentication failed" error |
| 400 | Missing/invalid request | Throw error with response body |
| 5xx | Bridge error | Throw error with status and body |
| Timeout | No response within 5s | `AbortSignal.timeout(5000)` throws |
| Connection refused | Bridge not running | Throw connection error |
