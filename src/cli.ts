#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Command } from 'commander';
import type { DisplayServer, PlatformAdapter } from './types.js';
import { detectDisplayServer, ensureTools } from './platform/detect.js';
import { PackageJsonSchema } from './schemas/commands.js';
import { X11Adapter } from './platform/x11.js';
import { WaylandAdapter } from './platform/wayland.js';
import { HyprlandAdapter } from './platform/hyprland.js';
import { MacOSAdapter } from './platform/macos.js';
import { registerScreenshot } from './commands/screenshot.js';
import { registerInfo } from './commands/info.js';
import { registerDom } from './commands/dom.js';
import { registerEval } from './commands/eval.js';
import { registerWait } from './commands/wait.js';
import { registerListWindows } from './commands/listWindows.js';
import { registerIpcMonitor } from './commands/ipcMonitor.js';
import { registerPageState } from './commands/pageState.js';
import { registerStorage } from './commands/storage.js';
import { registerConsoleMonitor } from './commands/consoleMonitor.js';
import { registerMutations } from './commands/mutations.js';
import { registerSnapshot } from './commands/snapshot.js';
import { registerDiff } from './commands/diff.js';
import { registerRustLogs } from './commands/rustLogs.js';
import { registerClick } from './commands/interact/click.js';
import { registerType } from './commands/interact/type.js';
import { registerScroll } from './commands/interact/scroll.js';
import { registerFocus } from './commands/interact/focus.js';
import { registerNavigate } from './commands/interact/navigate.js';
import { registerSelect } from './commands/interact/select.js';
import { registerInvoke } from './commands/invoke.js';
import { registerStoreInspect } from './commands/storeInspect.js';
import { registerCheck } from './commands/check.js';
import { registerProbe } from './commands/probe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = PackageJsonSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')));

const program = new Command()
  .name('tauri-agent-tools')
  .description('Agent-driven inspection toolkit for Tauri desktop apps')
  .version(pkg.version);

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

  if (ds === 'darwin') return new MacOSAdapter();
  if (ds === 'wayland-hyprland') return new HyprlandAdapter();
  if (ds === 'wayland-sway' || ds === 'wayland') return new WaylandAdapter();
  return new X11Adapter();
}

registerScreenshot(program, getAdapter);
registerInfo(program, getAdapter);
registerDom(program);
registerEval(program);
registerWait(program, getAdapter);
registerListWindows(program, getAdapter);
registerIpcMonitor(program);
registerPageState(program);
registerStorage(program);
registerConsoleMonitor(program);
registerMutations(program);
registerSnapshot(program, getAdapter);
registerDiff(program);
registerRustLogs(program);
registerClick(program);
registerType(program);
registerScroll(program);
registerFocus(program);
registerNavigate(program);
registerSelect(program);
registerInvoke(program);
registerStoreInspect(program);
registerCheck(program);
registerProbe(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
