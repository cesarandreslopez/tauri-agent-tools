# Feature: [Name]

## Module Placement

Which module(s) does this feature belong in?

| Module | Changes needed |
|--------|---------------|
| `schemas/` | New schemas or types? Which domain file? |
| `bridge/` | Bridge protocol changes? |
| `commands/` | New command or modify existing? |
| `platform/` | Platform adapter changes? |
| `util/` | New shared utilities? |
| `types.ts` | New interfaces? |

## Public API Changes

- [ ] New exports from existing modules
- [ ] New command registration in `cli.ts`
- [ ] Schema additions (specify domain file: bridge/dom/commands/platform)
- [ ] Type/interface additions

## Dependency Check

Does this introduce new inter-module dependencies?

- Current DAG: `schemas/ → util/ → bridge/|platform/ → commands/ → cli.ts`
- New dependency direction: ____________
- DAG violation? Yes / No

If yes, refactor to avoid upward dependencies. See `specs/refactor/architecture.md` (archived) for the allowed dependency matrix.

## Implementation Plan

- [ ] Add schemas/types (if any) to `schemas/<domain>.ts`
- [ ] Update barrel export in `schemas/index.ts` (if new schemas added)
- [ ] Implement core logic
- [ ] Register command in `cli.ts` (if new command)
- [ ] Add tests
- [ ] Run safety net: `npx tsc --noEmit && npm test && node scripts/check-imports.mjs && npx madge --circular --extensions ts,tsx src/`

## Testing

- [ ] Unit tests for new functions
- [ ] Schema validation tests (if new schemas)
- [ ] Integration test for cross-module interactions (if applicable)
