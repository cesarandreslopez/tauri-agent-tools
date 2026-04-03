import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from './shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { InteractionResultSchema } from '../../schemas/interact.js';

export function buildNavigateScript(target: string): string {
  const escaped = escapeSelector(target);
  if (target.startsWith('/')) {
    return `(function() {
  try {
    window.history.pushState({}, '', '${escaped}');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    return JSON.stringify({ success: true, tagName: 'window', selector: '${escaped}' });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
  }

  return `(function() {
  try {
    window.location.href = '${escaped}';
    return JSON.stringify({ success: true, tagName: 'window', selector: '${escaped}' });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
}

export function registerNavigate(program: Command): void {
  const cmd = new Command('navigate')
    .description('Navigate to a URL or path')
    .argument('<target>', 'URL or path to navigate to (paths starting with / use pushState)')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools navigate /dashboard
  $ tauri-agent-tools navigate /settings/profile
  $ tauri-agent-tools navigate https://example.com`);

  addInteractOptions(cmd);

  cmd.action(async (target: string, opts: BridgeOpts) => {
    const bridge = await resolveBridge(opts);
    const script = buildNavigateScript(target);
    const raw = await bridge.eval(script);
    const result = InteractionResultSchema.parse(JSON.parse(String(raw)));
    if (!result.success) {
      throw new Error(result.error ?? 'Navigate failed');
    }
    console.log(JSON.stringify(result, null, 2));
  });

  program.addCommand(cmd);
}
