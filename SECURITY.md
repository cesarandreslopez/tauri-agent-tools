# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest released version | Yes |
| Older releases | No; upgrade to the latest release |

## Security Model

tauri-agent-tools is designed with security as a core principle:

- **No native input injection** — no `xdotool`/Accessibility-API keyboard or mouse simulation. DOM/storage/screenshot inspection reads state. Evaluation and interaction run JavaScript through the debug bridge; application event handlers and Tauri commands may perform backend operations
- **`execFile()` only** — all OS commands use `execFile()` with array arguments, never `exec()` with shell strings (prevents command injection)
- **Token authentication** — bridge communication requires a random 32-character token
- **Localhost only** — bridge binds to `127.0.0.1`, never exposed to the network
- **Debug-only bridge** — the Rust bridge is wrapped in `cfg!(debug_assertions)`, stripped from release builds
- **Window ID validation** — adapters validate IDs before using them in external commands; numeric IDs and Hyprland hexadecimal addresses have different formats
- **Temporary instrumentation** — monitors, captures, and console-error checks wrap app APIs or install observers and attempt cleanup on stop; this is not enforced read-only execution
- **Shared evidence** — `bundle` stages artifacts privately and blocks publication on text-redaction failures. Images are unredacted, and automatic redaction does not replace review before sharing

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
