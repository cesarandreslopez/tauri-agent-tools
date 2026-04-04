import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { InvokeResultSchema } from '../schemas/interact.js';
import type { InvokeResult } from '../schemas/interact.js';

export function buildInvokeScript(command: string, args: unknown): string {
  const commandJson = JSON.stringify(command);
  const argsJson = JSON.stringify(args);
  return `(async () => {
  if (!window.__TAURI__ || !window.__TAURI__.core) {
    return JSON.stringify({ success: false, command: ${commandJson}, error: 'window.__TAURI__.core not found' });
  }
  try {
    var result = await window.__TAURI__.core.invoke(${commandJson}, ${argsJson});
    return JSON.stringify({ success: true, command: ${commandJson}, result: result });
  } catch (e) {
    return JSON.stringify({ success: false, command: ${commandJson}, error: e.message });
  }
})()`;
}

export function registerInvoke(program: Command): void {
  const cmd = new Command('invoke')
    .description('Call a Tauri IPC command via eval')
    .argument('<command>', 'Tauri command name')
    .argument('[args]', 'Command arguments as a JSON string')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(
    async (command: string, argsStr: string | undefined, opts: BridgeOpts & { json?: boolean }) => {
      let args: unknown = {};
      if (argsStr !== undefined) {
        try {
          args = JSON.parse(argsStr);
        } catch {
          throw new Error(`Invalid JSON for args: ${argsStr}`);
        }
      }

      const script = buildInvokeScript(command, args);
      const bridge = await resolveBridge(opts);
      const raw = await bridge.eval(script);
      const parsed: InvokeResult = InvokeResultSchema.parse(JSON.parse(String(raw)));

      if (!parsed.success) {
        throw new Error(`Tauri command "${command}" failed: ${parsed.error}`);
      }

      if (opts.json) {
        console.log(JSON.stringify(parsed, null, 2));
      } else {
        console.log(`Command: ${parsed.command}`);
        console.log(`Result:  ${JSON.stringify(parsed.result, null, 2)}`);
      }
    },
  );

  program.addCommand(cmd);
}
