# Contributing to tauri-agent-tools

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 9
- **Platform tools** (for running screenshot/window commands):
  - **Linux X11:** `xdotool`, `imagemagick`
  - **Linux Wayland/Sway:** `swaymsg`, `grim`, `imagemagick`
  - **Linux Wayland/Hyprland:** `hyprctl` (included with Hyprland), `grim`, `imagemagick`
  - **macOS:** `imagemagick` (via Homebrew) + Screen Recording permission

## Development Setup

```bash
# Clone the repository
git clone https://github.com/cesarandreslopez/tauri-agent-tools.git
cd tauri-agent-tools

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Watch mode (recompile on change)
npm run dev
```

## Project Structure

```
tauri-agent-tools/
├── src/
│   ├── cli.ts                  # Entry point — registers all commands
│   ├── types.ts                # Shared TypeScript types
│   ├── commands/
│   │   ├── shared.ts           # Bridge option wiring, resolveBridge()
│   │   ├── screenshot.ts       # DOM-targeted pixel capture
│   │   ├── dom.ts              # DOM tree inspection
│   │   ├── eval.ts             # JS expression evaluation
│   │   ├── wait.ts             # Condition polling
│   │   ├── info.ts             # Window geometry info
│   │   ├── listWindows.ts      # Window listing with Tauri detection
│   │   ├── ipcMonitor.ts       # Tauri IPC call monitoring
│   │   ├── consoleMonitor.ts   # Console output monitoring
│   │   ├── rustLogs.ts         # Rust/sidecar log capture
│   │   ├── storage.ts          # localStorage/sessionStorage/cookies
│   │   ├── pageState.ts        # URL, title, viewport, scroll state
│   │   ├── diff.ts             # Screenshot comparison
│   │   ├── mutations.ts        # DOM mutation watching
│   │   └── snapshot.ts         # Combined capture (screenshot + DOM + state + storage)
│   ├── platform/
│   │   ├── detect.ts           # Display server detection, tool checks
│   │   ├── x11.ts              # X11 adapter
│   │   ├── wayland.ts          # Wayland/Sway adapter
│   │   ├── hyprland.ts         # Wayland/Hyprland adapter
│   │   └── macos.ts            # macOS adapter
│   ├── bridge/
│   │   ├── client.ts           # BridgeClient — HTTP POST to /eval and /logs
│   │   └── tokenDiscovery.ts   # Token file scanning and PID checking
│   └── util/
│       ├── exec.ts             # execFile() wrapper, window ID validation
│       └── image.ts            # ImageMagick crop/resize operations
├── tests/                      # Vitest test files
├── rust-bridge/                # Integration guide for Rust bridge
├── examples/                   # Reference Rust bridge implementation
├── .agents/skills/             # Agent Skills for AI coding agents
└── docs/                       # Documentation site source
```

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **ESM imports** — always use `.js` extensions (NodeNext resolution)
- **Security first** — use `execFile()` with array args, never `exec()` with shell strings
- **Window ID validation** — validate with `/^\d+$/` before passing to external tools
- **Read-only** — no input injection, no state modification commands

## Branch Naming

Use descriptive branch names with a type prefix:

- `feature/<name>` — new features
- `fix/<name>` — bug fixes
- `docs/<name>` — documentation changes
- `refactor/<name>` — code refactoring
- `test/<name>` — test additions/changes

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add window resize detection
fix: handle missing xdotool on Wayland
docs: update bridge setup guide
refactor: extract crop computation to util
test: add screenshot crop region tests
chore: update dependencies
```

## Pull Request Process

1. **Fork** the repository and create your branch from `main`
2. **Make your changes** — keep PRs focused on a single concern
3. **Add tests** for new functionality
4. **Run the test suite** — `npm test` must pass
5. **Build successfully** — `npm run build` must complete without errors
6. **Submit a PR** with a clear description of what changed and why

## Areas for Contribution

- **Platform adapters** — Windows support, additional Wayland compositors
- **Command enhancements** — new flags, output formats, filtering options
- **Documentation** — guides, examples, tutorials
- **Tests** — edge cases, platform-specific behavior
- **Bug fixes** — especially cross-platform issues

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx vitest run tests/commands/screenshot.test.ts
```

Tests use vitest with globals enabled — `describe`, `it`, `expect` are available without imports.

## Questions?

- Open a [GitHub Issue](https://github.com/cesarandreslopez/tauri-agent-tools/issues) for bugs or feature requests
- Check existing issues before creating a new one
