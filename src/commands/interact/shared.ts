import type { Command } from 'commander';
import { addBridgeOptions } from '../shared.js';

/**
 * Escapes backslashes and single quotes in CSS selectors for safe
 * embedding inside JS string literals wrapped in single quotes.
 */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Builds a JS snippet that finds an element via querySelector and returns
 * JSON `{ found: true, tagName, id, text }` or `{ found: false }`.
 * Text content is truncated to 100 characters.
 */
export function buildFindElementScript(selector: string): string {
  const escaped = escapeSelector(selector);
  return [
    `(() => {`,
    `  const el = document.querySelector('${escaped}');`,
    `  if (!el) return JSON.stringify({ found: false });`,
    `  const text = (el.textContent || '').trim().slice(0, 100);`,
    `  return JSON.stringify({ found: true, tagName: el.tagName.toLowerCase(), id: el.id || undefined, text: text || undefined });`,
    `})()`,
  ].join('\n');
}

/**
 * When waitMs > 0, builds a JS snippet that polls every 100ms up to the
 * deadline for the element to appear, returning the same JSON shape as
 * buildFindElementScript. When waitMs <= 0, delegates to buildFindElementScript.
 */
export function buildWaitAndFindScript(selector: string, waitMs: number): string {
  if (waitMs <= 0) {
    return buildFindElementScript(selector);
  }

  const escaped = escapeSelector(selector);
  return [
    `new Promise((resolve) => {`,
    `  const deadline = Date.now() + ${waitMs};`,
    `  function poll() {`,
    `    const el = document.querySelector('${escaped}');`,
    `    if (el) {`,
    `      const text = (el.textContent || '').trim().slice(0, 100);`,
    `      resolve(JSON.stringify({ found: true, tagName: el.tagName.toLowerCase(), id: el.id || undefined, text: text || undefined }));`,
    `      return;`,
    `    }`,
    `    if (Date.now() >= deadline) {`,
    `      resolve(JSON.stringify({ found: false }));`,
    `      return;`,
    `    }`,
    `    setTimeout(poll, 100);`,
    `  }`,
    `  poll();`,
    `})`,
  ].join('\n');
}

/**
 * Adds shared interaction options to a command: bridge options (--port, --token)
 * plus --json for machine-readable output. Returns the command for chaining.
 */
export function addInteractOptions(cmd: Command): Command {
  return addBridgeOptions(cmd).option('--json', 'Output result as JSON');
}
