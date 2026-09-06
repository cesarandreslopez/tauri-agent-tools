# list-windows

List all visible windows, marking Tauri apps.

!!! success "No Bridge Required"
    This command works without a bridge. It detects Tauri apps by matching window PIDs against bridge token files.

## Usage

```bash
tauri-agent-tools list-windows [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output as JSON | — |
| `--tauri` | Only show Tauri app windows | — |

## Examples

### List all windows

```bash
tauri-agent-tools list-windows
```

```
ID        PID    NAME                SIZE       TAURI
12345678  1234   My Tauri App        1920x1080  yes (port 9876)
87654321  5678   Firefox             1920x1080  no
11223344  9012   Terminal            800x600    no
```

### Only Tauri windows

```bash
tauri-agent-tools list-windows --tauri
```

### JSON output

```bash
tauri-agent-tools list-windows --json
```

```json
[
  {
    "windowId": "12345678",
    "pid": 1234,
    "name": "My Tauri App",
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080,
    "tauri": true,
    "bridge": { "port": 9876, "token": "abc..." }
  }
]
```

## Notes

- Tauri detection works by cross-referencing window PIDs with bridge token files in `/tmp/`
- The `bridge` field in JSON output includes the port and token for direct bridge access
- Window listing uses platform-native tools (`xdotool` on X11, `swaymsg` on Wayland, `osascript` on macOS)

Window listing does not require ImageMagick. Hyprland uses `hyprctl`. On X11, a search with no windows returns an empty list; display and tool errors still fail.
