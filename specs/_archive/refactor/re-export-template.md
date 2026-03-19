# Compatibility Re-Export Pattern

When moving a symbol from one file to another during migration, the old location must temporarily re-export from the new location. This keeps all existing consumers working until they are individually updated.

## Pattern

### Step 1: Move the symbol to the new file

```typescript
// src/schemas/bridge.ts (NEW home)
import { z } from 'zod';

export const BridgeConfigSchema = z.object({
  port: z.number(),
  token: z.string(),
  pid: z.number(),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
```

### Step 2: Re-export from the old file with @deprecated

```typescript
// src/schemas.ts (OLD home — kept during transition)

/**
 * @deprecated Import from '../schemas/bridge.js' instead.
 * This re-export exists only for backward compatibility during migration
 * and will be removed once all consumers are updated.
 */
export { BridgeConfigSchema, type BridgeConfig } from './schemas/bridge.js';
```

### Rules

1. **Use explicit named re-exports.** Never use `export * from '...'` — it hides what's being re-exported and makes it impossible to track when all consumers have migrated.

2. **Always add `@deprecated` JSDoc.** This makes IDE consumers show a strikethrough, signaling that the import path should be updated.

3. **One re-export per symbol.** Group related symbols in a single re-export statement, but list each name explicitly:
   ```typescript
   /** @deprecated Import from '../schemas/bridge.js' instead. */
   export {
     BridgeConfigSchema,
     type BridgeConfig,
     ElementRectSchema,
     type ElementRect,
   } from './schemas/bridge.js';
   ```

4. **Type-only re-exports use `type` keyword.** This ensures no runtime overhead:
   ```typescript
   /** @deprecated Import from '../schemas/bridge.js' instead. */
   export { type BridgeConfig } from './schemas/bridge.js';
   ```

5. **Delete the re-export once all consumers are updated.** After migrating every importer of a symbol to the new path, remove its re-export from the old file. When the old file has no remaining exports, delete it entirely.

## Migration Checklist (per symbol)

- [ ] Symbol copied to new file and verified with `npx tsc --noEmit`
- [ ] Old file updated with `@deprecated` re-export
- [ ] All consumers still compile (`npx tsc --noEmit`) and tests pass (`npm test`)
- [ ] Consumers updated one-by-one to use new import path
- [ ] Re-export removed from old file
- [ ] Final verification: `npx tsc --noEmit && npm test && node scripts/check-imports.mjs`

## Example: Full Migration of BridgeConfig

```
1. Create src/schemas/bridge.ts with BridgeConfigSchema + BridgeConfig
2. In src/schemas.ts, replace definition with:
     /** @deprecated Import from './schemas/bridge.js' instead. */
     export { BridgeConfigSchema, type BridgeConfig } from './schemas/bridge.js';
3. Verify: npx tsc --noEmit && npm test  ← must pass
4. Update src/bridge/client.ts:
     - import { BridgeConfigSchema } from '../schemas/bridge.js';
     + (already done — was re-exported)
5. Update src/commands/shared.ts:
     - import type { BridgeConfig } from '../types.js';
     + import type { BridgeConfig } from '../schemas/bridge.js';
6. Repeat for all consumers of BridgeConfig
7. Remove BridgeConfig re-export from src/schemas.ts
8. Final verify: npx tsc --noEmit && npm test && node scripts/check-imports.mjs
```
