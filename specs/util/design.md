# util/ — Design Spec

## Purpose

Shared utilities for process execution and image manipulation via external tools (ImageMagick).

## Public Interface

From `util/exec.ts`:
- `exec(cmd: string, args: string[]): Promise<ExecResult>`
- `validateWindowId(id: string): string`
- `ExecResult` interface (`{ stdout: string; stderr: string }`)

From `util/image.ts`:
- `cropImage(buffer: Buffer, rect: CropRect, format: ImageFormat): Promise<Buffer>`
- `resizeImage(buffer: Buffer, width: number, height: number, format: ImageFormat): Promise<Buffer>`
- `computeCropRect(elementRect: ElementRect, viewport: ViewportSize, windowSize: { width: number; height: number }): CropRect`

## Internal Structure

```
src/util/
├── exec.ts     # execFile wrapper + window ID validation (46 lines)
└── image.ts    # ImageMagick crop/resize operations (46 lines)
```

## Dependencies

- **Allowed imports:** `schemas/`, `types.ts`
- **Forbidden imports:** `bridge/`, `commands/`, `platform/`, `cli.ts`

### Intra-module imports

- `image.ts` → `exec.ts` (for `exec()`)

### Schema imports after migration

| File | Schemas needed | Target import path |
|---|---|---|
| exec.ts | WindowIdSchema | `../schemas/platform.js` |
| image.ts | _(none — uses types.ts only)_ | — |

## Files to Move

| Source (current) | Destination (target) | Notes |
|---|---|---|
| `src/util/exec.ts` | `src/util/exec.ts` | Update: `../schemas.js` → `../schemas/platform.js` |
| `src/util/image.ts` | `src/util/image.ts` | No import changes needed |

## Open Questions

None. This module is small and well-scoped.
