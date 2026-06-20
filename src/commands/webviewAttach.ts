import { Command } from 'commander';
import { exec } from '../util/exec.js';
import {
  addBridgeOptions,
  resolveBridge,
  endpointAvailable,
  endpointUnavailableNote,
} from './shared.js';
import type { BridgeOpts } from './shared.js';
import type { DevtoolsResponse } from '../schemas/bridge.js';

interface WebviewAttachOpts extends BridgeOpts {
  printUrl?: boolean;
  open?: boolean;
  json?: boolean;
}

export function registerWebviewAttach(program: Command): void {
  const cmd = new Command('webview')
    .description('Webview/devtools introspection (requires bridge v0.7.0+)');
  const sub = cmd
    .command('attach')
    .description('Print the platform devtools URL or hint, optionally open in a browser')
    .option('--print-url', 'Print only the inspector URL (or empty string if none)')
    .option('--open', 'Open the inspector URL in the default browser (if available)')
    .option('--json', 'Output as JSON');

  addBridgeOptions(sub);

  sub.action(async (opts: WebviewAttachOpts) => {
    const bridge = await resolveBridge(opts);

    // Graceful degradation: older bridges (pre-v0.7) have no /devtools endpoint.
    if (!(await endpointAvailable(bridge, '/devtools', opts))) {
      const note = endpointUnavailableNote('/devtools', (await bridge.version())?.version);
      if (opts.json) {
        console.log(JSON.stringify({ endpoint: '/devtools', available: false, note }, null, 2));
      } else if (opts.printUrl) {
        // Keep --print-url contract: emit an empty line when no URL is available.
        console.log('');
        console.error(`note: ${note}`);
      } else {
        console.error(`note: ${note}`);
      }
      return;
    }

    const dt = await bridge.devtools();

    if (opts.json) {
      console.log(JSON.stringify(dt, null, 2));
      return;
    }
    if (opts.printUrl) {
      console.log(dt.url ?? '');
      return;
    }

    renderHuman(dt);

    if (opts.open) {
      if (!dt.url) {
        console.error('--open requested but no inspector URL is available on this platform.');
        process.exitCode = 2;
        return;
      }
      await openInBrowser(dt.url);
    }
  });

  program.addCommand(cmd);
}

function renderHuman(dt: DevtoolsResponse): void {
  console.log(`Webview platform: ${dt.platform}`);
  console.log(`Inspectable:      ${dt.inspectable ? 'yes' : 'no'}`);
  if (dt.url) {
    console.log(`Inspector URL:    ${dt.url}`);
  } else {
    console.log(`Inspector URL:    (not exposed)`);
  }
  console.log(`Hint:             ${dt.hint}`);
}

async function openInBrowser(url: string): Promise<void> {
  // Cross-platform default-browser open via the host's standard tool.
  const bin = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    await exec(bin, args, { timeout: 5000 });
  } catch (err) {
    console.error(`Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
