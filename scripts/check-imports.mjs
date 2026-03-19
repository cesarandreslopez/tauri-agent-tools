#!/usr/bin/env node

/**
 * Import DAG linter for tauri-agent-tools.
 *
 * Enforces the module dependency hierarchy documented in
 * specs/refactor/architecture.md. Each module may only import
 * from modules listed in ALLOWED_DEPS; all other internal imports
 * are violations.
 *
 * Usage:
 *   node scripts/check-imports.mjs          # lint all src/**\/*.ts
 *   node scripts/check-imports.mjs --json   # output violations as JSON
 *
 * Exit codes:
 *   0 — no violations
 *   1 — violations found
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// ─── Configuration ──────────────────────────────────────────────────────────

const SRC_DIR = resolve(import.meta.dirname, '..', 'src');

/**
 * Allowed imports for each module (directory or file).
 * Key format: directory name with trailing slash, or bare filename.
 *
 * During migration, both 'schemas.ts' (monolith) and 'schemas/' (split)
 * are accepted. Once migration completes, remove the 'schemas.ts' entry.
 */
const ALLOWED_DEPS = {
  // Leaf — only external (zod)
  'schemas/':    [],
  // schemas.ts (legacy monolith) — leaf during transition
  'schemas.ts':  [],

  'types.ts':    ['schemas/', 'schemas.ts'],

  'util/':       ['schemas/', 'schemas.ts', 'types.ts'],

  'bridge/':     ['schemas/', 'schemas.ts', 'types.ts'],

  'platform/':   ['util/', 'schemas/', 'schemas.ts', 'types.ts'],

  'commands/':   ['bridge/', 'platform/', 'util/', 'schemas/', 'schemas.ts', 'types.ts'],

  'cli.ts':      ['commands/', 'platform/', 'bridge/', 'schemas/', 'schemas.ts', 'types.ts'],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all .ts files under a directory recursively. */
function collectTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract relative import specifiers from a TypeScript source file.
 * Matches both `import ... from '...'` and `import type ... from '...'`.
 * Ignores external (non-relative) imports.
 */
function extractRelativeImports(source) {
  const imports = [];
  // Match import declarations with relative paths
  const re = /import\s+(?:type\s+)?(?:\{[^}]*\}|[^'"]*)\s+from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/**
 * Determine which module a file belongs to.
 * Returns the module key used in ALLOWED_DEPS (e.g., 'commands/', 'cli.ts').
 */
function getModule(filePath) {
  const rel = relative(SRC_DIR, filePath);
  const parts = rel.split('/');
  if (parts.length === 1) {
    // Root-level file: cli.ts, types.ts, schemas.ts
    return parts[0];
  }
  // Directory-based module: commands/, bridge/, etc.
  return parts[0] + '/';
}

/**
 * Resolve a relative import specifier to a target module key.
 * Handles .js → .ts mapping and directory resolution.
 */
function resolveImportTarget(importingFile, specifier) {
  const importingDir = dirname(importingFile);
  // Strip .js extension (ESM convention) to get the logical path
  let resolved = specifier.replace(/\.js$/, '');
  resolved = resolve(importingDir, resolved);
  const rel = relative(SRC_DIR, resolved);

  // If it points outside src/, ignore
  if (rel.startsWith('..')) return null;

  const parts = rel.split('/');

  if (parts.length === 1) {
    // Root-level target: types.ts, schemas.ts, cli.ts
    return parts[0] + '.ts';
  }

  // Directory-based target
  return parts[0] + '/';
}

// ─── Main ───────────────────────────────────────────────────────────────────

function lint() {
  const files = collectTsFiles(SRC_DIR);
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const imports = extractRelativeImports(source);
    const fromModule = getModule(file);
    const allowed = ALLOWED_DEPS[fromModule];

    if (!allowed) {
      // Module not in ALLOWED_DEPS — skip (shouldn't happen)
      continue;
    }

    for (const spec of imports) {
      const targetModule = resolveImportTarget(file, spec);
      if (targetModule === null) continue; // external or outside src/

      // Intra-module imports are always allowed
      if (targetModule === fromModule) continue;

      if (!allowed.includes(targetModule)) {
        violations.push({
          file: relative(SRC_DIR, file),
          import: spec,
          fromModule,
          targetModule,
        });
      }
    }
  }

  return violations;
}

const jsonFlag = process.argv.includes('--json');
const violations = lint();

if (violations.length === 0) {
  if (!jsonFlag) {
    console.log('✔ No import DAG violations found.');
  } else {
    console.log(JSON.stringify([], null, 2));
  }
  process.exit(0);
} else {
  if (jsonFlag) {
    console.log(JSON.stringify(violations, null, 2));
  } else {
    console.error(`✘ ${violations.length} import DAG violation(s):\n`);
    for (const v of violations) {
      console.error(`  ${v.file}: '${v.import}'`);
      console.error(`    ${v.fromModule} → ${v.targetModule} (not allowed)\n`);
    }
  }
  process.exit(1);
}
