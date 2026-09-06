# Command Reference

tauri-agent-tools provides 38 commands for inspecting, interacting with, monitoring, post-mortem analysis, and diagnosing Tauri applications. DOM, screenshot, and storage inspection read state; `eval` can change it, and monitors install temporary instrumentation. Interaction commands are debug-only (require the dev bridge). Bridge-free diagnostics work on dead apps and release builds.

## Command Summary

| Command | Bridge Required | Description |
|---------|:--------------:|-------------|
| [`screenshot`](screenshot.md) | Optional | Capture a screenshot of a window or DOM element |
| [`dom`](dom.md) | Yes | Query DOM structure or accessibility tree |
| [`eval`](eval.md) | Yes | Evaluate a JavaScript expression |
| [`wait`](wait.md) | Optional | Wait for a condition to be met |
| [`info`](info.md) | No | Show window geometry and display server info |
| [`list-windows`](list-windows.md) | No | List all visible windows, marking Tauri apps |
| [`ipc-monitor`](ipc-monitor.md) | Yes | Monitor Tauri IPC calls in real-time |
| [`console-monitor`](console-monitor.md) | Yes | Monitor console output in real-time |
| [`rust-logs`](rust-logs.md) | Yes | Monitor Rust backend logs and sidecar output |
| [`storage`](storage.md) | Yes | Inspect localStorage, sessionStorage, and cookies |
| [`page-state`](page-state.md) | Yes | Query webview page state |
| [`diff`](diff.md) | No | Compare two screenshots with difference metrics |
| [`mutations`](mutations.md) | Yes | Watch DOM mutations on a CSS selector |
| [`snapshot`](snapshot.md) | Yes | Capture screenshot + DOM + page state + storage in one shot |
| `click` | Yes | Click a DOM element |
| `type` | Yes | Type text into an input (native value setter, verified write) |
| `scroll` | Yes | Scroll window or element |
| `focus` | Yes | Focus a DOM element |
| `navigate` | Yes | Navigate within the app |
| `select` | Yes | Select dropdown value or toggle checkbox (native setter / `click()`, verified write) |
| `invoke` | Yes | Invoke a Tauri IPC command |
| `probe` | Optional | Discover running bridges and check health; reports `target.alive: false` instead of erroring when none found |
| `capture` | Yes | Full debug evidence bundle |
| `check` | Yes | Structured assertions (exit 0/1) |
| `store-inspect` | Yes | Inspect reactive store state |
| `app-paths` | No | Resolve Tauri 2 OS data/log/cache/config dirs |
| `config inspect` | No | Snapshot `tauri.conf.json` + capability audit |
| `os-logs` | No | Tail host OS logs filtered to a bundle id |
| `sidecar tap` | No | Wrap a sidecar, frame stdout as NDJSON, validate |
| `sidecar replay` | No | Replay a recorded NDJSON stream; `--tap-format` unwraps tap wrapper rows, `--dir in\|out` filters by direction |
| `forensics` | No | Post-crash bundle (works on dead apps) |
| `logs` | Optional | Merge scattered app logs (on-disk + bridge ring buffer) into one timestamp-ordered stream; `--follow` tails the live bridge via v0.8 non-draining cursor reads (drain-polling fallback on older bridges) |
| `process-tree` | Optional with `--deep`/PID | Tauri PID + registered sidecars with liveness |
| `capabilities audit` | Yes; v0.7+ for full output | Live capability audit (wildcards, over-broad scopes) |
| `webview attach` | Yes; v0.7+ for full output | Webview inspector URL or platform hint |
| `health` | Yes; v0.7+ for full output | Quick "is this app sick" check (CI-friendly) |
| `diagnose` | Optional | Best-effort super-command (forensics + bridge data) |
| `bundle` | Optional | Shareable incident archive: merged logs + process tree + app-paths + forensics (+ optional capture), redacted |

## Categories

### Visual Capture

- **[screenshot](screenshot.md)** — capture full windows or specific DOM elements with real screen pixels
- **[diff](diff.md)** — compare two screenshots with pixel-level difference metrics
- **[snapshot](snapshot.md)** — capture screenshot + DOM tree + page state + storage in a single call

### DOM Inspection

- **[dom](dom.md)** — explore DOM tree structure, accessibility tree, computed styles
- **[eval](eval.md)** — run arbitrary JS expressions in the webview (supports `--file` for loading from files)

### Monitoring

- **[ipc-monitor](ipc-monitor.md)** — watch Tauri IPC calls with timing and filtering
- **[console-monitor](console-monitor.md)** — capture console.log/warn/error output
- **[rust-logs](rust-logs.md)** — monitor Rust tracing/log output and sidecar processes
- **[mutations](mutations.md)** — watch DOM mutations with attribute tracking

### State Inspection

- **[storage](storage.md)** — read localStorage, sessionStorage, and cookies
- **[page-state](page-state.md)** — URL, title, viewport, scroll position, Tauri detection
- **store-inspect** — inspect reactive store state (Pinia, Vue devtools, custom hooks)

### Window Management

- **[info](info.md)** — window geometry, position, display server
- **[list-windows](list-windows.md)** — enumerate windows with Tauri detection
- **[wait](wait.md)** — poll for windows, DOM elements, or JS conditions

### Interaction (debug-only)

- **click** — click, double-click, or right-click a DOM element
- **type** — type text into an input field through the native value setter and verify the write (supports `--clear`, `--verify-timeout`)
- **scroll** — scroll by pixels, to top/bottom, or scroll an element into view
- **focus** — focus a DOM element
- **navigate** — navigate to a route or URL
- **select** — select a dropdown value via the native value setter, or toggle a checkbox via native `click()`, verifying the write
- **invoke** — call a Tauri IPC command with JSON payload

### Workflow

- **probe** — discover running bridges, check health, list window labels; when no bridge is discoverable and no explicit `--port`/`--token`/`--pid` is given, emits a complete result with `target.alive: false` and an actionable note instead of erroring
- **capture** — collect screenshot + DOM + page state + storage + console errors + Rust logs into a bundle
- **check** — run structured assertions against DOM state (selector exists, text matches, no console errors)

### Bridge-free diagnostics (new in 0.7)

Work without the dev bridge — for release builds, dead apps, and sidecar processes.

- **app-paths** — resolve a Tauri 2 app's OS data/log/cache/config directories from `tauri.conf.json`
- **config inspect** — emit a structured snapshot of `tauri.conf.json` plus a capability/permission audit
- **os-logs** — tail the host OS log stream filtered to a Tauri bundle id (NDJSON envelopes)
- **sidecar tap** — wrap-and-run a sidecar binary, frame its stdout as NDJSON, validate against an optional JSON Schema
- **sidecar replay** — replay a recorded NDJSON stream to stdout or into a fresh process; `--tap-format` unwraps `{dir,ts,line}` tap wrapper rows, optionally filtered by `--dir in|out`
- **forensics** — one-shot bundle for post-crash analysis (composes the above; works on dead apps)
- **logs** — merge an app's scattered logs (on-disk `tauri-plugin-log` files + the live bridge `/logs` ring buffer) into one timestamp-ordered NDJSON stream, normalized to UTC; filter by `--level`/`--source`/`--filter` and `--correlate` to infer correlation ids (works with no bridge); `--follow` tails the live bridge via v0.8 non-draining cursor reads, falling back to drain-polling on older bridges (`--interval <ms>` sets the fallback poll interval, default 2000)

### Bridge-extending diagnostics

Feature-detect via `GET /version` and degrade with a note against older bridges. Use `--strict` to fail when an endpoint is unavailable. `process-tree --deep` uses an OS walk and can work without a bridge when a PID is provided.

- **process-tree** — Tauri PID + registered sidecars rendered as a tree
- **capabilities audit** — live audit of declared Tauri capabilities, flags wildcard and over-broad scopes
- **webview attach** — webview inspector URL or platform hint (`webview2`, `webkitgtk`, `wkwebview`)
- **health** — uptime + webview readiness + per-sidecar liveness; exits non-zero when unhealthy

### Super-command

- **diagnose** — best-effort. Composes `forensics` with live bridge data when reachable; degrades cleanly when not. Master `summary.md` includes a "Next steps" section pointing at the right deeper command.
- **bundle** — collect a shareable incident archive (merged `logs` + deep `process-tree` + `app-paths` + `forensics`, plus an optional UI `capture`) into one directory and a `.tar.gz`. Secrets (tokens, API keys, passwords, JWTs, AWS keys) and PII (emails, IPs, phone numbers, home paths — including base64-encoded ones) are redacted from text artifacts on write; JSON/NDJSON artifacts are re-serialized so they stay parseable; unredacted images are flagged as warnings; each phase degrades cleanly.

## Common Patterns

### JSON output

All commands that produce structured output support `--json`:

```bash
tauri-agent-tools info --title "My App" --json
tauri-agent-tools dom --json
tauri-agent-tools storage --json
```

### Bridge auto-discovery

Commands that need the bridge automatically discover it via token files in `/tmp/`. You can override with explicit flags:

```bash
tauri-agent-tools dom --port 9876 --token abc123
```

### Duration-based monitoring

Monitor commands accept `--duration` to auto-stop:

```bash
tauri-agent-tools ipc-monitor --duration 5000
tauri-agent-tools console-monitor --duration 10000 --level error
tauri-agent-tools rust-logs --duration 10000 --level warn
```

### Automation contracts

- `eval --json` returns `{ "result": value }` and awaits promises. `wait` and `check --eval` use JavaScript truthiness before serialization. Thrown expressions fail.
- Fatal errors with `--json` use `{ "error": { "code": "…", "message": "…", "hint": "…" } }` on stderr and exit nonzero. Results stay on stdout, including failed assertions and image-threshold results. Monitor records are NDJSON; warnings go to stderr.
- `wait` requires exactly one condition; `check` requires at least one assertion. `check --no-errors` fails if observation is interrupted, entries are dropped, or cleanup fails.
- Timeouts and polling intervals require positive integers. Depths, `click --wait`, and `capture --logs-duration` allow zero. Ports must be 1–65535; image thresholds must be 0–100. Conflicting click, scroll, evaluation-source, and replay-destination options are rejected.
- `probe --json` identifies the selected PID, port, and window label and notes ambiguous auto-discovery. Use `--pid` for a specific app and `--window-label` for its webview.
- Console, IPC, and mutation collectors have independent 1,000-entry buffers, report overflow, and take a final sample on stop. Rust log readers (`logs`, `rust-logs`, `capture`) use independent v0.8 cursors, with a warning and destructive drain fallback on older bridges.
- `capture` preserves other artifacts when screenshot tools are unavailable and records `partial`, `warnings`, and `errorCount` in its manifest. An interrupted capture saves available evidence and cleans up its observer.
- `diagnose --no-bridge` skips all bridge enrichment, even with an explicit target. `logs --follow` requires a bridge and cannot be combined with `--no-bridge`.
- `config inspect` and config discovery accept JSON5/JSONC without damaging URLs or comment-like strings inside values.

### Shareable bundles

`bundle` collects privately, redacts text and structured credentials, and checks for residual secrets before publishing its directory or archive. Redaction failures prevent publication. Missing sources produce failed phases and `partial: true`. Images remain unredacted and appear in warnings.

Only artifacts from the current run enter the archive. Unrelated existing output files are preserved and excluded; artifact symlinks are rejected. Archive failure leaves sanitized directory evidence and reports `archive: null`. `--no-archive` intentionally produces only the directory. Review artifacts before sharing.

Quote a complete replay command: `sidecar replay recording.ndjson --to-exec "node my-sidecar.js"`. This value is split on spaces; shell syntax and arguments containing spaces are unsupported.
