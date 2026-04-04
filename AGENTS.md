# tauri-agent-tools

CLI tool for agent-driven inspection and interaction with Tauri desktop applications. **Not an MCP server** — invoke commands directly via shell.

## Agent Skills

This package includes two [Agent Skills](https://agentskills.io):

| Skill | Path | Purpose |
|-------|------|---------|
| `tauri-agent-tools` | `.agents/skills/tauri-agent-tools/SKILL.md` | Using all 25 CLI commands to inspect and interact with Tauri apps |
| `tauri-bridge-setup` | `.agents/skills/tauri-bridge-setup/SKILL.md` | Adding the Rust dev bridge to a Tauri project |

## Quick Reference

**Install:** `npm install -g tauri-agent-tools`

**Inspection commands are read-only.** Interaction commands (click, type, scroll, etc.) are debug-only — they only work with the dev bridge.

**Standalone commands** (no bridge needed):
`list-windows`, `info`, `screenshot --title`, `wait --title`, `diff`

**Bridge-required commands** (Tauri app must have dev bridge running):
`dom`, `eval`, `screenshot --selector`, `wait --selector/--eval`, `ipc-monitor`, `console-monitor`, `rust-logs`, `storage`, `page-state`, `mutations`, `snapshot`, `click`, `type`, `scroll`, `focus`, `navigate`, `select`, `invoke`, `capture`, `check`, `store-inspect`

**Optional bridge:**
`probe` (works standalone to discover bridges, richer output with bridge)

**Multi-app targeting:** Use `--pid <n>` to target a specific app. Use `--window-label <label>` for multi-window apps.

**Bridge auto-discovery:** The CLI finds the running bridge via token files in `/tmp/tauri-dev-bridge-*.token`. No manual configuration needed.

**Structured output:** Use `--json` on any command for machine-readable output.

**Monitors:** Always pass `--duration <ms>` to `ipc-monitor`, `console-monitor`, `rust-logs`, and `mutations` to avoid indefinite execution.

**Sidecar monitoring:** `rust-logs` can capture stdout/stderr from sidecar processes (external binaries spawned by the Tauri app). Use `--source sidecar` for all sidecars or `--source sidecar:<name>` for a specific one.
