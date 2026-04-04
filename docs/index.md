# tauri-agent-tools

**Agent-driven inspection toolkit for Tauri desktop apps.**

25 commands to screenshot, inspect, interact with, and monitor Tauri apps from the CLI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/cesarandreslopez/tauri-agent-tools/blob/main/LICENSE)
[![Node >= 20](https://img.shields.io/badge/Node-%3E%3D20-green.svg)](https://nodejs.org)

![tauri-agent-tools](https://raw.githubusercontent.com/cesarandreslopez/tauri-agent-tools/main/assets/social-preview.png)

## The Problem

Debugging frontend issues in Tauri desktop apps requires manually screenshotting, cropping, and describing what you see. Existing tools either hijack your cursor (xcap-based), render DOM to canvas (html2canvas — can't capture WebGL/video/canvas elements), or have no authentication.

## The Solution

Combine a bridge's knowledge of element positions (`getBoundingClientRect`) with real pixel screenshots (`import -window` + ImageMagick crop). No other tool does this.

## Features

- **DOM-targeted capture** — screenshot any CSS-selectable element with real screen pixels
- **25 commands** — 14 read-only inspection commands plus 11 interaction and workflow commands (click, type, scroll, focus, navigate, select, invoke, probe, capture, check, store-inspect)
- **Cross-platform** — Linux X11, Linux Wayland/Sway, Linux Wayland/Hyprland, macOS
- **Token authenticated** — random 32-char token, localhost-only bridge
- **Agent Skills** — ships agentskills.io skills for AI coding agents
- **JSON output** — all commands support `--json` for structured output

## Quick Install

```bash
npm install -g tauri-agent-tools
```

See [Installation](getting-started/installation.md) for platform-specific requirements.

## Quick Example

```bash
# Screenshot a specific DOM element
tauri-agent-tools screenshot --selector ".toolbar" -o /tmp/toolbar.png

# Explore the DOM tree
tauri-agent-tools dom --depth 3

# Monitor IPC calls in real-time
tauri-agent-tools ipc-monitor --duration 10000
```

## Next Steps

- [Installation](getting-started/installation.md) — set up system requirements
- [Quick Start](getting-started/quick-start.md) — get running in 5 minutes
- [Bridge Setup](getting-started/bridge-setup.md) — integrate the Rust bridge
- [Command Reference](commands/index.md) — all 25 commands with examples
- [Architecture Overview](architecture/overview.md) — how it works under the hood
