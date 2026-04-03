import type { Command } from 'commander';
import { addBridgeOptions } from '../shared.js';

export type BridgeOpts = {
  port?: number;
  token?: string;
};

/**
 * Escape a CSS selector for embedding in a JS string literal (single-quoted).
 */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Add bridge options (--port, --token) to a command.
 * Mirrors addBridgeOptions from the parent shared.ts.
 */
export function addInteractOptions(cmd: Command): Command {
  return addBridgeOptions(cmd);
}
