# Platform Support

## Platform Matrix

| Platform | Display Server | Status | Screenshot | Window List | Window Geometry |
|----------|---------------|--------|:----------:|:-----------:|:---------------:|
| Linux | X11 | Supported | `import` | `xdotool` | `xdotool` |
| Linux | Wayland (Sway) | Supported | `grim` | `swaymsg` | `swaymsg` |
| Linux | Wayland (Hyprland) | Supported | `grim` | `hyprctl` | `hyprctl` |
| macOS | CoreGraphics | Supported | `screencapture` | `osascript` | `osascript` |
| Windows | — | Planned | — | — | — |

## Display Server Detection

The CLI detects the display server when an operation needs native window tools:

```mermaid
flowchart TD
    A[detectDisplayServer] --> B{process.platform === 'darwin'?}
    B -->|yes| C[darwin]
    B -->|no| D{Wayland session?}
    D -->|yes| E{SWAYSOCK set?}
    E -->|yes| F[wayland-sway]
    E -->|no| G{HYPRLAND_INSTANCE_SIGNATURE set?}
    G -->|yes| H[wayland-hyprland]
    G -->|no| I[wayland]
    D -->|no| J{DISPLAY set?}
    J -->|yes| K[x11]
    J -->|no| L[unknown → error]
```

## Platform Details

=== "Linux X11"

    **Required tools:**

    | Tool | Package | Purpose |
    |------|---------|---------|
    | `xdotool` | `xdotool` | Window search, geometry, listing |
    | ImageMagick | `imagemagick` | Screenshot capture (`import`), crop and resize |

    ```bash
    sudo apt install xdotool imagemagick
    ```

    Both ImageMagick v6 (`convert`, `import`) and v7 (`magick`) are detected automatically.

    **How it works:**

    - `xdotool search --name <regex>` finds windows by title
    - `xdotool getwindowgeometry <id>` gets position and size
    - `import -window <id> png:-` captures window pixels to stdout (v7: `magick import`)
    - ImageMagick crops and resizes via stdin/stdout pipes

=== "Linux Wayland (Sway)"

    **Required tools:**

    | Tool | Package | Purpose |
    |------|---------|---------|
    | `swaymsg` | `sway` | Window listing and geometry via IPC |
    | `grim` | `grim` | Screenshot capture |
    | ImageMagick | `imagemagick` | Image crop and resize |

    ```bash
    sudo apt install sway grim imagemagick
    ```

    **How it works:**

    - `swaymsg -t get_tree` lists all windows with geometry
    - `grim -g <geometry>` captures a screen region
    - ImageMagick crops and resizes via stdin/stdout pipes

    !!! warning "Compositor Support"
        Other Wayland compositors (GNOME, KDE) would need their own adapters. Currently Sway and Hyprland are supported.

=== "Linux Wayland (Hyprland)"

    **Required tools:**

    | Tool | Package | Purpose |
    |------|---------|---------|
    | `hyprctl` | Hyprland | Window listing and geometry via IPC |
    | `grim` | `grim` | Screenshot capture |
    | ImageMagick | `imagemagick` | Image crop and resize |

    ```bash
    sudo apt install grim imagemagick
    # hyprctl is included with Hyprland
    ```

    **How it works:**

    - `hyprctl clients -j` lists all windows with geometry as JSON
    - `grim -g <geometry>` captures a screen region
    - ImageMagick crops and resizes via stdin/stdout pipes

=== "macOS"

    **Required tools:**

    | Tool | Package | Purpose |
    |------|---------|---------|
    | `screencapture` | Built-in | Window screenshot capture |
    | `osascript` | Built-in | Window search and geometry via AppleScript |
    | `sips` | Built-in | Image format info |
    | ImageMagick | `imagemagick` | Image crop and resize |

    ```bash
    brew install imagemagick
    ```

    **How it works:**

    - AppleScript queries `System Events` for window properties
    - `screencapture -l <windowId>` captures a specific window
    - ImageMagick crops and resizes via stdin/stdout pipes

    !!! note "Screen Recording Permission"
        macOS requires Screen Recording permission for `screencapture`. Grant it in **System Settings > Privacy & Security > Screen Recording** for your terminal application.

=== "Windows (Planned)"

    Native window inspection and screenshots are not implemented on Windows. Bridge commands and supported bridge-free diagnostics can still run; `os-logs` remains a stub and the deep OS process walk is Unix-only.

    Potential approach: PowerShell for window enumeration, .NET APIs for screenshot capture.

## Tool Verification

The CLI checks for required tools on first use and reports missing ones:

```bash
$ tauri-agent-tools list-windows
Missing required tool: xdotool. Install the window-inspection tool for your display server.
```

Checks are cached by display server and operation. Window inspection needs only the window tool; native full-window PNG capture on macOS/Wayland does not require ImageMagick. Crops, resizing, JPEG output, diff, and X11 capture do. Bridge-only commands do not initialize an adapter. Title matching uses regex on X11 and substrings on macOS/Sway/Hyprland.
