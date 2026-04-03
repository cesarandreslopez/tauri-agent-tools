import type { Command } from 'commander';
import { addBridgeOptions } from '../shared.js';

/**
 * Escape a CSS selector for safe embedding in a JS string literal (single-quoted).
 * Escapes backslashes first, then single quotes.
 */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Add shared interact command options: bridge options + --json.
 */
export function addInteractOptions(cmd: Command): Command {
  addBridgeOptions(cmd);
  cmd.option('--json', 'Output structured JSON result');
  return cmd;
}

export type InteractOpts = {
  port?: number;
  token?: string;
  json?: boolean;
};
