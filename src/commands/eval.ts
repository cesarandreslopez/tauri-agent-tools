import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { evaluateExpression } from '../bridge/evaluate.js';
import { CliError } from '../util/errors.js';

export function registerEval(program: Command): void {
  const cmd = new Command('eval')
    .description('Evaluate a JavaScript expression in the Tauri app')
    .argument('[expression]', 'JavaScript expression to evaluate')
    .option('--file <path>', 'Read JavaScript from a file instead of argument')
    .option('--json', 'Output a JSON object containing the evaluated result')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools eval "document.title"
  $ tauri-agent-tools eval "window.location.href"
  $ tauri-agent-tools eval "document.querySelectorAll('button').length"
  $ tauri-agent-tools eval --file script.js`);

  addBridgeOptions(cmd);

  cmd.action(async (expression: string | undefined, opts: BridgeOpts & { file?: string; json?: boolean }) => {
    if (expression !== undefined && opts.file !== undefined) {
      throw new CliError('INVALID_ARGUMENT', 'Provide either an expression or --file, not both', 'Use eval --help for examples.');
    }
    let js: string;

    if (opts.file) {
      js = await readFile(opts.file, 'utf-8');
    } else if (expression) {
      js = expression;
    } else {
      throw new Error('Provide either an <expression> argument or --file <path>');
    }

    const bridge = await resolveBridge(opts);
    const { value: result } = await evaluateExpression(bridge, js);

    if (opts.json) {
      console.log(JSON.stringify({ result }, null, 2));
      return;
    }

    if (typeof result === 'string') {
      // Try to pretty-print if it's JSON
      try {
        const parsed = JSON.parse(result);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(result);
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  });

  program.addCommand(cmd);
}
