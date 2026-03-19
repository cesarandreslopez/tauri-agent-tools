# platform/ — Design Spec

## Purpose

Platform-specific window operations (find, capture, geometry, list). Three adapters (X11, Wayland, macOS) implement the `PlatformAdapter` interface. Detection logic selects the correct adapter at runtime.

## Public Interface

From `platform/detect.ts`:
- `detectDisplayServer(): DisplayServer`
- `ensureTools(server: DisplayServer): Promise<void>`
- `checkX11Tools(): Promise<ToolCheck[]>`
- `checkWaylandTools(): Promise<ToolCheck[]>`
- `checkMacOSTools(): Promise<ToolCheck[]>`
- `ToolCheck` interface

From `platform/x11.ts`:
- `X11Adapter` class (implements `PlatformAdapter`)

From `platform/wayland.ts`:
- `WaylandAdapter` class (implements `PlatformAdapter`)

From `platform/macos.ts`:
- `MacOSAdapter` class (implements `PlatformAdapter`)

## Internal Structure

```
src/platform/
├── detect.ts    # Display server detection + tool checks (88 lines)
├── x11.ts       # X11 adapter: xdotool + ImageMagick import (88 lines)
├── wayland.ts   # Wayland/Sway adapter: swaymsg + grim (103 lines)
└── macos.ts     # macOS adapter: screencapture + osascript + sips (137 lines)
```

## Dependencies

- **Allowed imports:** `util/`, `schemas/`, `types.ts`
- **Forbidden imports:** `bridge/`, `commands/`, `cli.ts`

### Schema imports after migration

| File | Schemas needed | Target import path |
|---|---|---|
| wayland.ts | SwayNodeSchema | `../schemas/platform.js` |
| macos.ts | CGWindowInfoSchema | `../schemas/platform.js` |
| detect.ts | _(none)_ | — |
| x11.ts | _(none)_ | — |

## Files to Move

| Source (current) | Destination (target) | Notes |
|---|---|---|
| `src/platform/detect.ts` | `src/platform/detect.ts` | No import changes needed |
| `src/platform/x11.ts` | `src/platform/x11.ts` | No import changes needed |
| `src/platform/wayland.ts` | `src/platform/wayland.ts` | Update: `../schemas.js` → `../schemas/platform.js` |
| `src/platform/macos.ts` | `src/platform/macos.ts` | Update: `../schemas.js` → `../schemas/platform.js` |

## Open Questions

- **macOS JXA scripts:** `macos.ts` contains a JXA (JavaScript for Automation) script string for `osascript`. Similar to the bridge eval embedded JS concern, but platform-specific. Defer extraction to future phase.
