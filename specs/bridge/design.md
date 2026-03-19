# bridge/ — Design Spec

## Purpose

HTTP communication with the Tauri dev bridge: eval endpoint, log endpoint, and token-based auto-discovery.

## Public Interface

Exports from `bridge/client.ts`:
- `BridgeClient` class
  - `eval(js: string, timeout?: number): Promise<unknown>`
  - `getElementRect(selector: string): Promise<ElementRect | null>`
  - `getViewportSize(): Promise<ViewportSize>`
  - `getDocumentTitle(): Promise<string>`
  - `getAccessibilityTree(selector?: string, depth?: number): Promise<A11yNode | null>`
  - `fetchLogs(timeout?: number): Promise<RustLogEntry[]>`
  - `ping(): Promise<boolean>`

Exports from `bridge/tokenDiscovery.ts`:
- `discoverBridge(): Promise<BridgeConfig | null>`
- `discoverBridgesByPid(): Promise<Map<number, BridgeConfig>>`

## Internal Structure

```
src/bridge/
├── client.ts           # BridgeClient class (161 lines)
└── tokenDiscovery.ts   # Token file scanning (89 lines)
```

## Dependencies

- **Allowed imports:** `schemas/`, `types.ts`
- **Forbidden imports:** `commands/`, `platform/`, `util/`, `cli.ts`

### Specific schema imports after migration

| File | Current import | Target import |
|---|---|---|
| `client.ts` | `../schemas.js` → ElementRectSchema, ViewportSizeSchema, A11yNodeSchema, BridgeEvalResponseSchema, BridgeLogsResponseSchema | `../schemas/bridge.js` → ElementRectSchema, ViewportSizeSchema, BridgeEvalResponseSchema, BridgeLogsResponseSchema; `../schemas/dom.js` → A11yNodeSchema |
| `client.ts` | `../types.js` → BridgeConfig, ElementRect, RustLogEntry, A11yNode | `../types.js` → (only for non-schema interfaces); `../schemas/bridge.js` → BridgeConfig, ElementRect, RustLogEntry; `../schemas/dom.js` → A11yNode |
| `tokenDiscovery.ts` | `../schemas.js` → TokenFileSchema | `../schemas/bridge.js` → TokenFileSchema |
| `tokenDiscovery.ts` | `../types.js` → BridgeConfig | `../schemas/bridge.js` → BridgeConfig |

## Files to Move

| Source (current) | Destination (target) | Notes |
|---|---|---|
| `src/bridge/client.ts` | `src/bridge/client.ts` | Update import paths only |
| `src/bridge/tokenDiscovery.ts` | `src/bridge/tokenDiscovery.ts` | Update import paths only |

## Open Questions

- **Embedded JS in client.ts:** The `getAccessibilityTree()` method contains a ~55-line JavaScript template literal. Extracting this to a separate file would improve testability but is deferred to a future phase (see Decision D6 in architecture.md).
