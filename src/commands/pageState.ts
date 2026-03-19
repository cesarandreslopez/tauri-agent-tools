import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import { PageStateSchema } from '../schemas/commands.js';
import type { PageState } from '../schemas/commands.js';

const PAGE_STATE_SCRIPT = `(() => {
  var state = {
    url: window.location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    hasTauri: !!(window.__TAURI__)
  };
  return JSON.stringify(state);
})()`;

function formatPageState(state: PageState): string {
  const lines = [
    `URL:             ${state.url}`,
    `Title:           ${state.title}`,
    `Viewport:        ${state.viewport.width}x${state.viewport.height}`,
    `Scroll Position: ${state.scroll.x}, ${state.scroll.y}`,
    `Document Size:   ${state.document.width}x${state.document.height}`,
    `Tauri:           ${state.hasTauri ? 'yes' : 'no'}`,
  ];
  return lines.join('\n');
}

export function registerPageState(program: Command): void {
  const cmd = new Command('page-state')
    .description('Query webview page state (URL, title, viewport, scroll, document size)')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: { json?: boolean; port?: number; token?: string }) => {
    const bridge = await resolveBridge(opts);
    const raw = await bridge.eval(PAGE_STATE_SCRIPT);
    const state = PageStateSchema.parse(JSON.parse(String(raw)));

    if (opts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(formatPageState(state));
    }
  });

  program.addCommand(cmd);
}
