import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { InvokeResultSchema } from '../schemas/interact.js';
import type { InvokeResult } from '../schemas/interact.js';

export function buildInvokeScript(command: string, args: unknown): string {
  const commandJson = JSON.stringify(command);
  const argsJson = JSON.stringify(args);
  return `(async () => {
  function getTauriInvoke() {
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
    }
    return null;
  }
  var invoke = getTauriInvoke();
  if (!invoke) {
    return JSON.stringify({ success: false, command: ${commandJson}, error: 'Tauri invoke API not found: expected window.__TAURI_INTERNALS__.invoke or window.__TAURI__.core.invoke' });
  }
  try {
    var result = await invoke(${commandJson}, ${argsJson});
    return JSON.stringify({ success: true, command: ${commandJson}, result: result });
  } catch (e) {
    return JSON.stringify({ success: false, command: ${commandJson}, error: e && e.message ? e.message : String(e) });
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
