# Installation

## Install from npm

```bash
npm install -g tauri-agent-tools
```

Verify the installation:

```bash
tauri-agent-tools --version
```

## System Requirements

**Node.js >= 20** is required (uses native `fetch()`).

Platform-specific tools are also needed for screenshot and window operations:

=== "Linux X11"

    ```bash
    sudo apt install xdotool imagemagick
    ```

    Tools used: `xdotool` (window search/geometry), `import` (screenshot capture), `convert` (crop/resize).

=== "Linux Wayland/Sway"

    ```bash
    sudo apt install sway grim imagemagick
    ```

    Tools used: `swaymsg` (window listing/geometry), `grim` (screenshot capture), `convert` (crop/resize).

=== "Linux Wayland/Hyprland"

    ```bash
    sudo apt install grim imagemagick
    # hyprctl is included with Hyprland
    ```

    Tools used: `hyprctl` (window listing/geometry), `grim` (screenshot capture), `convert` (crop/resize).

=== "macOS"

    ```bash
    brew install imagemagick
    ```

    Built-in tools used: `screencapture`, `osascript`, `sips`. ImageMagick provides `convert` for crop/resize.

    !!! note "Screen Recording Permission"
        Grant Screen Recording permission in **System Settings > Privacy & Security > Screen Recording** for your terminal app.

## Build from Source

```bash
git clone https://github.com/cesarandreslopez/tauri-agent-tools.git
cd tauri-agent-tools
npm install
npm run build
npm link
```

## Verify Setup

Run a quick check to ensure platform tools are available:

```bash
# This will report any missing tools
tauri-agent-tools list-windows
```

If any required tools are missing, the CLI will report which ones to install.
