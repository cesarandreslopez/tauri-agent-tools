# storage

Inspect localStorage, sessionStorage, and cookies from the Tauri webview. One-shot read — no writes.

!!! note "Bridge Required"
    This command requires an active bridge connection.

## Usage

```bash
tauri-agent-tools storage [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Storage type: `local`, `session`, `cookies`, `all` | `all` |
| `--key <name>` | Get a specific key's value | — |
| `--json` | Output as JSON | — |
| `--port <number>` | Bridge port (auto-discover if omitted) | — |
| `--token <string>` | Bridge token (auto-discover if omitted) | — |
| `--pid <number>` | Select an app bridge by PID | — |
| `--window-label <label>` | Select a webview | `main` |

## Examples

### Show all storage

```bash
tauri-agent-tools storage
```

```
localStorage (3 entries)
  theme = "dark"
  language = "en"
  sidebar_collapsed = "true"

sessionStorage (1 entry)
  active_tab = "settings"

cookies (2 entries)
  session_id = "abc123"
  preferences = "compact"
```

### Show only localStorage

```bash
tauri-agent-tools storage --type local
```

### Get a specific key

```bash
tauri-agent-tools storage --key theme
```

```
localStorage: dark
```

### JSON output

```bash
tauri-agent-tools storage --json
```

```json
{
  "localStorage": [
    { "key": "theme", "value": "dark" },
    { "key": "language", "value": "en" }
  ],
  "sessionStorage": [],
  "cookies": [
    { "key": "session_id", "value": "abc123" }
  ]
}
```

## Notes

- This is a one-shot read — storage is read once and displayed
- Cookie access is limited to `document.cookie` (HttpOnly cookies are not visible)
- When using `--key`, the value is looked up in all selected storage types
