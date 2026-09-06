#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Command, CommanderError } from 'commander';
import type { AdapterOperation, PlatformAdapter } from './types.js';
import { detectDisplayServer, ensureTools } from './platform/detect.js';
import { PackageJsonSchema } from './schemas/commands.js';
import { X11Adapter } from './platform/x11.js';
import { WaylandAdapter } from './platform/wayland.js';
import { HyprlandAdapter } from './platform/hyprland.js';
import { MacOSAdapter } from './platform/macos.js';
import { errorDetail } from './errors.js';
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
import { registerCapture } from './commands/capture.js';
import { registerAppPaths } from './commands/appPaths.js';
import { registerConfigInspect } from './commands/configInspect.js';
import { registerOsLogs } from './commands/osLogs.js';
import { registerSidecarTap } from './commands/sidecarTap.js';
import { registerSidecarReplay } from './commands/sidecarReplay.js';
import { registerForensics } from './commands/forensics.js';
import { registerLogs } from './commands/logs.js';
import { registerBundle } from './commands/bundle.js';
import { registerProcessTree } from './commands/processTree.js';
import { registerCapabilitiesAudit } from './commands/capabilitiesAudit.js';
import { registerWebviewAttach } from './commands/webviewAttach.js';
import { registerHealth } from './commands/health.js';
import { registerDiagnose } from './commands/diagnose.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = PackageJsonSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')));

const program = new Command()
  .name('tauri-agent-tools')
  .description('Agent-driven inspection toolkit for Tauri desktop apps')
  .version(pkg.version);

const checkedTools = new Set<string>();

async function getAdapter(operation: AdapterOperation = 'inspect'): Promise<PlatformAdapter> {
  const ds = detectDisplayServer();
  if (ds === 'unknown') {
    throw new Error(
      process.platform === 'win32' ? 'Native window inspection is supported on macOS and Linux. Bridge and bridge-free diagnostic commands remain available.' : 'Could not detect display server. Set DISPLAY (X11) or WAYLAND_DISPLAY (Wayland).',
    );
  }

  const key = `${ds}:${operation}`;
  if (!checkedTools.has(key)) {
    await ensureTools(ds, operation);
    checkedTools.add(key);
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
registerCapture(program, getAdapter);

// ── Bridge-free diagnostics (Tier 1) ─────────────────────────────────────────
registerAppPaths(program);
registerConfigInspect(program);
registerOsLogs(program);
registerSidecarTap(program);
registerSidecarReplay(program);
registerForensics(program);
registerLogs(program);

// ── Bridge-extending diagnostics (Tier 2 — requires bridge v0.7.0+) ──────────
registerProcessTree(program);
registerCapabilitiesAudit(program);
registerWebviewAttach(program);
registerHealth(program);

// ── Tier 3: super-commands (compose Tier 1 + Tier 2) ─────────────────────────
registerDiagnose(program);
registerBundle(program);

const args = process.argv.slice(2);
const endOfOptions = args.indexOf('--');
const jsonRequested = (endOfOptions === -1 ? args : args.slice(0, endOfOptions)).includes('--json');
function configureErrors(command: Command): void {
  command.exitOverride();
  command.configureOutput({ writeErr: message => { if (!jsonRequested) process.stderr.write(message); } });
  command.commands.forEach(configureErrors);
}
configureErrors(program);
program.parseAsync().catch((err: unknown) => {
  if (err instanceof CommanderError && err.exitCode === 0) return;
  const detail = err instanceof CommanderError
    ? { code: 'INVALID_ARGUMENT', message: err.message, hint: 'Use this command with --help for supported options.' }
    : errorDetail(err);
  if (jsonRequested) console.error(JSON.stringify({ error: detail }));
  else if (!(err instanceof CommanderError)) console.error(`${detail.message}\nHint: ${detail.hint}`);
  process.exitCode = 1;
});
