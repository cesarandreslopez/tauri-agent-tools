---
name: tauri-debug-quickstart
description: First-30-seconds triage for a broken Tauri desktop app. Pick the right command for the symptom you're seeing, with one-line escalations to deeper skills.
version: 0.9.0
tags: [tauri, debugging, triage, quickstart, decision-tree, logs, process-tree, bundle, forensics, diagnose]
---

# Tauri Debug Quickstart

When something is wrong with a Tauri app, the first 30 seconds matter — they decide whether you spend the next hour reading the right logs or the wrong ones. This skill points you at the right `tauri-agent-tools` command for the symptom you're seeing.

## The single-command answer

If you don't know where to start, run this first:

```bash
tauri-agent-tools diagnose --config ./src-tauri -o ./diagnose-out
```

`diagnose` is a best-effort super-command that:

1. Resolves the app's config + OS data/log paths
2. Runs a forensics bundle (works even on dead apps — tails app logs for panics, pulls macOS DiagnosticReports, lists app-data files)
3. If a live dev bridge is reachable, layers `/process`, `/capabilities`, `/devtools`, `/health` data on top
4. Writes a master `summary.md` with detected anomalies and suggested next steps

Then open `./diagnose-out/summary.md` and follow the "Next steps" section.

## Symptom → command (when you need precision)

Pick the row that matches what's broken. Each command works without the bridge unless noted.

| Symptom | First command | Why |
|---|---|---|
| Don't know what's wrong | `tauri-agent-tools diagnose -o ./diag` | Everything-bundle; graceful on dead apps |
| App crashed at startup | `tauri-agent-tools forensics --config ./src-tauri -o ./forensics` | Reads app log + DiagnosticReports without needing a live process |
| App is running but bridge isn't responding | `tauri-agent-tools probe` | Detects whether the bridge process is up and shows token-file state |
| App is running, bridge is up, but webview looks wrong | `tauri-agent-tools health --json` | Returns webview_ready + sidecar liveness (richer on bridge v0.7+; degrades to a liveness ping otherwise) |
| Evidence is scattered across webview/Rust/sidecar logs | `tauri-agent-tools logs --config ./src-tauri --pretty` | Merges on-disk log files + the bridge ring buffer into one timestamp-ordered timeline |
| Need to watch logs live while reproducing | `tauri-agent-tools logs --follow --pretty` | Needs bridge; multi-consumer-safe on bridge v0.8+, drain-polling fallback otherwise |
| What did the sidecar actually spawn (MCP servers, workers)? | `tauri-agent-tools process-tree --deep --json` | Walks the real OS descendant tree, including unregistered grandchildren — no bridge needed |
| Need one shareable archive of everything for a bug report | `tauri-agent-tools bundle --config ./src-tauri -o ./triage` | Logs + deep process tree + app-paths + forensics → redacted dir + `.tar.gz` |
| A sidecar process is the suspect | `tauri-agent-tools sidecar tap --schema ./schema.json -- <cmd>` | Wrap-and-run the sidecar standalone; frame NDJSON; validate envelopes |
| Need to know exactly which files the app touches | `tauri-agent-tools app-paths --config ./src-tauri --exists` | Resolves Tauri 2's per-platform `app_data_dir`/`app_log_dir`/etc. + checks existence |
| Need to audit Tauri capabilities for over-broad permissions | `tauri-agent-tools config inspect --config ./src-tauri` (static) **or** `tauri-agent-tools capabilities audit` (live, needs bridge v0.7+) | Flags `*`, `fs:allow-all`, `shell:allow-spawn`, etc. |
| OS-level error visible in Console.app or journalctl | `tauri-agent-tools os-logs --identifier com.example.app --level error --duration 30000` | Filters platform log stream to the Tauri bundle id |
| Inspector / webview attach | `tauri-agent-tools webview attach` *(needs bridge v0.7+)* | Returns inspector URL or platform-specific hint |
| What sidecars did this app spawn? | `tauri-agent-tools process-tree --json` (or `--deep`) | Bridge /process lists registered sidecars (v0.7+); `--deep` walks the OS tree with no bridge |

## Decision tree

```
The app is...
│
├── crashed / not running ────────► forensics
│   └─ no source on hand? ────────► forensics --identifier com.foo.bar
│
├── running but bridge down ──────► probe → fix bridge → retry
│
└── running, bridge up
    ├── webview misbehaving ──────► health → snapshot → capabilities audit
    ├── sidecar suspected ────────► sidecar tap (run sidecar under it standalone)
    ├── IPC slow / wrong ─────────► ipc-monitor → check
    └── DOM / UI inspection ──────► dom → screenshot → eval
```

When in doubt, escalate to `diagnose` — its `summary.md` will tell you which deeper command to use.

## Output conventions

- All commands accept `--json` for machine-readable output.
- Bundle commands (`forensics`, `diagnose`) write a `summary.md` agents can open directly and a `summary.json` agents can parse.
- Streaming commands (`os-logs`, `rust-logs`, `sidecar tap`, `logs --follow`) and one-shot `logs` emit one NDJSON envelope per line on stdout.
- Bridge v0.7+ commands feature-detect via `GET /version` and **degrade gracefully** (a clear `note:`, plus an OS/eval fallback where possible) against older bridges. Pass `--strict` to turn a missing endpoint into a hard error instead.

## When this skill is wrong

This guidance assumes the agent is inspecting a Tauri 2 desktop app on macOS or Linux. Caveats:

- **Tauri 1 apps** — the `dirs`/`directories-next` path semantics that `app-paths` encodes match Tauri 2's `PathResolver`. Tauri 1's paths differ; some derived paths will be slightly off.
- **Windows** — `os-logs` is stubbed in v0.7 (the Windows event log adapter is planned). `forensics` and `diagnose` still produce useful bundles on Windows; they just skip the live OS-log tail.
- **The dev bridge requires `cfg!(debug_assertions)`** — release builds strip it, so bridge-dependent commands won't work against signed/notarized release artifacts. Use bridge-free commands (`forensics`, `app-paths`, `os-logs`, `config inspect`, `sidecar tap`) for those.

For deeper how-tos see the [`tauri-agent-tools`](../tauri-agent-tools/SKILL.md) skill. For bridge integration setup (Rust side), see [`tauri-bridge-setup`](../tauri-bridge-setup/SKILL.md).
