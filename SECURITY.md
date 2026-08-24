# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Security Model

tauri-agent-tools is designed with security as a core principle:

- **No native input injection** — no `xdotool`/Accessibility-API keyboard or mouse simulation. Inspection commands are read-only; interaction commands (`click`, `type`, `select`, `scroll`, `focus`, `navigate`, `invoke`) act only through JavaScript evaluated inside the webview via the debug-only bridge and cannot reach the OS or other applications
- **`execFile()` only** — all OS commands use `execFile()` with array arguments, never `exec()` with shell strings (prevents command injection)
- **Token authentication** — bridge communication requires a random 32-character token
- **Localhost only** — bridge binds to `127.0.0.1`, never exposed to the network
- **Debug-only bridge** — the Rust bridge is wrapped in `cfg!(debug_assertions)`, stripped from release builds
- **Window ID validation** — all window IDs validated against `/^\d+$/` before use

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainers with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Assessment:** within 1 week
- **Fix release:** within 2 weeks for critical issues

## Scope

The following are in scope:

- Command injection via CLI arguments
- Token leakage or authentication bypass
- Unintended write operations or state modification
- Path traversal in output file handling

The following are out of scope:

- Vulnerabilities in system tools (`xdotool`, `imagemagick`, etc.)
- Local privilege escalation (the tool runs with user permissions)
- Denial of service via resource exhaustion
