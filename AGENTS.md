# tauri-agent-tools

CLI tool for agent-driven inspection and interaction with Tauri desktop applications. **Not an MCP server** — invoke commands directly via shell.

## Agent Skills

This package includes three [Agent Skills](https://agentskills.io):

| Skill | Path | Purpose |
|-------|------|---------|
| `tauri-agent-tools` | `.agents/skills/tauri-agent-tools/SKILL.md` | Using all 38 CLI commands to inspect and interact with Tauri apps |
| `tauri-bridge-setup` | `.agents/skills/tauri-bridge-setup/SKILL.md` | Adding the Rust dev bridge to a Tauri project |
| `tauri-debug-quickstart` | `.agents/skills/tauri-debug-quickstart/SKILL.md` | First-30-seconds triage — pick the right command for the symptom |

## Quick Reference

**Install:** `npm install -g tauri-agent-tools`

**DOM, screenshot, and storage inspection read app state.** `eval` can modify app state. Monitors install temporary instrumentation. Interaction commands (click, type, scroll, etc.) are debug-only — they only work with the dev bridge.

**Standalone commands** (no bridge needed):
`list-windows`, `info`, `screenshot --title`, `wait --title`, `diff`

**Bridge-free diagnostics** (work on release builds, dead apps, and sidecars — no bridge required):
`app-paths`, `config inspect`, `os-logs`, `sidecar tap`, `sidecar replay`, `forensics`, `logs` (also reads the live bridge ring buffer when present), `process-tree --deep` (walks the full OS descendant tree)

**Bridge-required commands** (Tauri app must have dev bridge running):
`dom`, `eval`, `screenshot --selector`, `wait --selector/--eval`, `ipc-monitor`, `console-monitor`, `rust-logs`, `storage`, `page-state`, `mutations`, `snapshot`, `click`, `type`, `scroll`, `focus`, `navigate`, `select`, `invoke`, `capture`, `check`, `store-inspect`

**Bridge-extending diagnostics** (use bridge v0.7+ for full output; degrade gracefully against older/vendored bridges, or pass `--strict` to fail):
`process-tree`, `capabilities audit`, `webview attach`, `health`

**Super-commands** (best-effort, compose the above):
`diagnose` (one-shot triage report), `bundle` (shareable, redacted incident archive → directory + `.tar.gz`)

**Optional bridge:**
`probe` (works standalone to discover bridges, richer output with bridge), `logs` (on-disk only with `--no-bridge`)

**Multi-app targeting:** Use `--pid <n>` to target a specific app. Use `--window-label <label>` for multi-window apps.

**Bridge auto-discovery:** The CLI finds the running bridge via token files in `/tmp/tauri-dev-bridge-*.token`. No manual configuration needed.

**Structured output:** Use `--json` where supported for machine-readable output. Fatal JSON errors go to stderr; command results stay on stdout.

**Monitors:** Always pass `--duration <ms>` to `ipc-monitor`, `console-monitor`, `rust-logs`, and `mutations` to avoid indefinite execution.

**Sidecar monitoring:** `rust-logs` can capture stdout/stderr from sidecar processes (external binaries spawned by the Tauri app). Use `--source sidecar` for all sidecars or `--source sidecar:<name>` for a specific one.

**Automation:** `wait` requires exactly one condition, and `check` requires at least one assertion. An interrupted `check --no-errors` fails. `capture` reports incomplete evidence with `partial` and `warnings`. Console/IPC/mutation collectors keep independent bounded sessions; Rust log readers use independent cursors on bridge v0.8+.

**Release checks:** Run `npm run lint`, `npm test`, `cargo test --locked --manifest-path examples/tauri-bridge/Cargo.toml`, `zensical build`, and `npm run check:package`. The example lockfile is tracked; Rust build outputs are excluded from npm.
