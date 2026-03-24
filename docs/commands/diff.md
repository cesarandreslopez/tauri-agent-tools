# diff

Compare two screenshots and output difference metrics.

!!! note "No Bridge Required"
    This command operates on local image files — no bridge or running Tauri app needed.

## Usage

```bash
tauri-agent-tools diff <image1> <image2> [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `<image1>` | First image path | (required) |
| `<image2>` | Second image path | (required) |
| `-o, --output <path>` | Write a visual diff image to this path | — |
| `--threshold <percent>` | Fail (exit code 1) if difference exceeds this percentage | — |
| `--json` | Output structured JSON | — |

## Examples

### Basic comparison

```bash
tauri-agent-tools diff /tmp/before.png /tmp/after.png
```

```
Pixels different: 1500
Total pixels:     2073600
Difference:       0.072%
```

### Generate a diff image

```bash
tauri-agent-tools diff /tmp/before.png /tmp/after.png -o /tmp/diff.png
```

### Threshold gating (CI use)

```bash
# Fail if more than 1% of pixels differ
tauri-agent-tools diff /tmp/expected.png /tmp/actual.png --threshold 1
echo $?  # 0 = pass, 1 = threshold exceeded
```

### JSON output

```bash
tauri-agent-tools diff /tmp/a.png /tmp/b.png --json
```

```json
{
  "pixelsDifferent": 1500,
  "totalPixels": 2073600,
  "percentDifferent": 0.07233,
  "diffImage": null
}
```

## Requirements

Requires ImageMagick installed on the system. Both v6 (`compare`, `identify`) and v7 (`magick compare`, `magick identify`) are supported automatically. The `--threshold` option requires `identify` to compute image dimensions.
