import type { Command } from 'commander';
import { addBridgeOptions } from '../shared.js';

export type BridgeOpts = {
  port?: number;
  token?: string;
  json?: boolean;
};

/**
 * Add bridge options (--port, --token) plus --json to an interact sub-command.
 */
export function addInteractOptions(cmd: Command): Command {
  addBridgeOptions(cmd);
  cmd.option('--json', 'Output structured JSON result');
  return cmd;
}

/**
 * Escape a CSS selector for safe embedding in a JS string literal (single-quoted).
 * Escapes backslashes and single quotes.
 */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
