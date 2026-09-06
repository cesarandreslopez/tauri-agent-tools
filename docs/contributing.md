# Contributing

Thank you for your interest in contributing to tauri-agent-tools!

For complete contribution guidelines, see the [CONTRIBUTING.md](https://github.com/cesarandreslopez/tauri-agent-tools/blob/main/CONTRIBUTING.md) in the repository root.

## Quick Links

- [Development Setup](https://github.com/cesarandreslopez/tauri-agent-tools/blob/main/CONTRIBUTING.md#development-setup)
- [Code Style](https://github.com/cesarandreslopez/tauri-agent-tools/blob/main/CONTRIBUTING.md#code-style)
- [Pull Request Process](https://github.com/cesarandreslopez/tauri-agent-tools/blob/main/CONTRIBUTING.md#pull-request-process)

## Key Commands

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript
npm run lint      # Bridge parity, import boundaries, typecheck, ESLint
npm test          # Run tests
npm run check:package # Verify published files and version consistency
npm run dev       # Watch mode
```

## Areas for Contribution

- **Platform adapters** — Windows support, additional Wayland compositors
- **Command enhancements** — new flags, output formats, filtering
- **Documentation** — guides, examples, tutorials
- **Tests** — edge cases, platform-specific behavior
- **Bug fixes** — especially cross-platform issues

The CI matrix covers Node 20/24 on Ubuntu, Node 24 on macOS, and locked Rust bridge builds on both platforms. See the root contribution guide for Rust prerequisites, package inspection, and the release sequence. Build this site with `zensical build`.
