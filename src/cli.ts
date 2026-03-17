#!/usr/bin/env node
import { Command } from 'commander';
import type { DisplayServer, PlatformAdapter } from './types.js';
import { detectDisplayServer, ensureTools } from './platform/detect.js';
import { X11Adapter } from './platform/x11.js';
import { WaylandAdapter } from './platform/wayland.js';
import { registerScreenshot } from './commands/screenshot.js';
import { registerInfo } from './commands/info.js';
import { registerDom } from './commands/dom.js';
import { registerEval } from './commands/eval.js';
import { registerWait } from './commands/wait.js';

const program = new Command()
  .name('tauri-dev-tools')
  .description('DOM-targeted pixel capture for Tauri apps')
  .version('0.1.0');

let checkedTools: DisplayServer | null = null;

async function getAdapter(): Promise<PlatformAdapter> {
  const ds = detectDisplayServer();
  if (ds === 'unknown') {
    throw new Error(
      'Could not detect display server. Set DISPLAY (X11) or WAYLAND_DISPLAY (Wayland).',
    );
  }

  if (checkedTools !== ds) {
    await ensureTools(ds);
    checkedTools = ds;
  }

  return ds === 'x11' ? new X11Adapter() : new WaylandAdapter();
}

registerScreenshot(program, getAdapter);
registerInfo(program, getAdapter);
registerDom(program);
registerEval(program);
registerWait(program, getAdapter);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
