import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';

export function registerEval(program: Command): void {
  const cmd = new Command('eval')
    .description('Evaluate a JavaScript expression in the Tauri app')
    .argument('<expression>', 'JavaScript expression to evaluate')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools eval "document.title"
  $ tauri-agent-tools eval "window.location.href"
  $ tauri-agent-tools eval "document.querySelectorAll('button').length"`);

  addBridgeOptions(cmd);

  cmd.action(async (expression: string, opts: { port?: number; token?: string }) => {
    const bridge = await resolveBridge(opts);
    const result = await bridge.eval(expression);

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
