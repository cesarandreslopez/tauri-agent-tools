# tauri-agent-tools v0.6.0 — Agent Convenience Overhaul

**Date:** 2026-04-03
**Status:** Approved

## Problem

tauri-agent-tools v0.5.1 has 14 read-only inspection commands. Agents face three gaps:

1. **No interaction** — can observe but not drive the app (click, type, scroll, navigate)
2. **Low-level primitives only** — debugging requires 5-10 sequential commands with no workflow abstraction
3. **Blind targeting** — first-match bridge discovery; no multi-window; no app self-description

## Solution: Five Layers

### Layer 1: Targeting & Discovery

- `--pid <n>` flag on all bridge commands for multi-app targeting
- `--window-label <label>` flag for multi-window eval (bridge reads optional `window` field in /eval requests)
- `probe` command — resolve target, report PID, bridge health, available windows, platform tools, app surfaces/exports
- Bridge additions: `GET /version`, `POST /describe` (app metadata, surfaces, exports)

### Layer 2: Interaction Commands (Eval-Based Hybrid)

DOM interactions via eval (follows existing dom/storage/ipc-monitor pattern):
- `click <selector>` — mousedown + mouseup + click events, `--double`, `--right`, `--wait`
- `type <selector> <text>` — focus, optionally clear, set value with input/change events
- `scroll` — `--by`, `--to`, `--to-top`, `--to-bottom`, `--into-view`, `--selector`
- `focus <selector>` — element.focus()
- `navigate <url|path>` — router push or location.href
- `select <selector> <value>` — dropdowns, checkboxes, radios

Bridge-native for Tauri IPC:
- `invoke <command> [args-json]` — calls __TAURI__.core.invoke via eval; dedicated POST /invoke endpoint for permission bypass

### Layer 3: High-Level Workflow Commands

- `capture -o <dir>` — enhanced snapshot producing manifest directory with screenshot, DOM, page-state, storage, console-errors, rust-logs, IPC-recent, and named exports. Compact `manifest.json` for token-efficient agent consumption.
- `check` — structured assertions: `--selector`, `--text`, `--eval`, `--no-errors`, `--diff`, `--threshold`. Composable. Exit 0/1 with JSON failure reasons.
- `--eval-file <path>` on `eval` command for complex inspection scripts.

### Layer 4: State Observability

- `store-inspect` — auto-detects framework stores (`__DEBUG_STORES__` > Pinia > Vue devtools > Redux). Options: `--framework`, `--store <name>`, `--depth`.

### Layer 5: Contextful-Specific Agent Skill

- `.agents/skills/contextful-desktop/SKILL.md` — store reference, canvas eval recipes, view navigation, common debugging workflows, interaction patterns.

## Bridge Protocol Changes

| Endpoint | Auth | Status | Purpose |
|----------|------|--------|---------|
| POST /eval | token | Modified (optional `window` field) | Multi-window JS eval |
| POST /logs | token | Unchanged | Log buffer drain |
| POST /describe | token | New | App metadata, surfaces, exports |
| POST /invoke | token | New | Direct Tauri IPC |
| GET /version | none | New | Bridge version + endpoint list |

All new endpoints additive. CLI handles 404 gracefully.

## Implementation Phases

1. **Foundation** — --pid, --window-label, probe, bridge /describe + /version
2. **Interaction** — click, type, scroll, focus, navigate, select, invoke, --eval-file
3. **Workflows** — capture, check
4. **Observability** — store-inspect
5. **Skills** — update tauri-agent-tools skill, update bridge-setup skill, create contextful-desktop skill

## Key Design Decisions

- **Eval-based interactions** — follows existing patterns, no bridge changes for DOM commands
- **Surfaces/exports as data** — apps register their own named selectors and debug expressions via /describe
- **Canvas inspection via skill, not command** — too app-specific for generic tooling
- **manifest.json in capture** — compact summary for token-efficient agent context
- **Backward-compatible bridge** — 404 fallback on all new endpoints
