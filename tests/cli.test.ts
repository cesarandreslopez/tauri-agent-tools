import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock all platform adapters and bridge discovery to prevent side effects
vi.mock('../src/platform/detect.js', () => ({
  detectDisplayServer: vi.fn().mockReturnValue('x11'),
  ensureTools: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/platform/x11.js', () => ({
  X11Adapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/platform/wayland.js', () => ({
  WaylandAdapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/platform/macos.js', () => ({
  MacOSAdapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
}));

// Import all register functions
import { registerScreenshot } from '../src/commands/screenshot.js';
import { registerInfo } from '../src/commands/info.js';
import { registerDom } from '../src/commands/dom.js';
import { registerEval } from '../src/commands/eval.js';
import { registerWait } from '../src/commands/wait.js';
import { registerListWindows } from '../src/commands/listWindows.js';
import { registerIpcMonitor } from '../src/commands/ipcMonitor.js';
import { registerPageState } from '../src/commands/pageState.js';
import { registerStorage } from '../src/commands/storage.js';
import { registerConsoleMonitor } from '../src/commands/consoleMonitor.js';
import { registerMutations } from '../src/commands/mutations.js';
import { registerSnapshot } from '../src/commands/snapshot.js';
import { registerDiff } from '../src/commands/diff.js';
import { registerRustLogs } from '../src/commands/rustLogs.js';

describe('CLI command registration', () => {
  let program: Command;
  const getAdapter = vi.fn();

  beforeEach(() => {
    program = new Command().name('tauri-agent-tools');
  });

  it('registers all 14 commands without error', () => {
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

    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toHaveLength(14);
  });

  it('registers the expected command names', () => {
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

    const commandNames = program.commands.map((c) => c.name()).sort();
    expect(commandNames).toEqual([
      'console-monitor',
      'diff',
      'dom',
      'eval',
      'info',
      'ipc-monitor',
      'list-windows',
      'mutations',
      'page-state',
      'rust-logs',
      'screenshot',
      'snapshot',
      'storage',
      'wait',
    ]);
  });

  it('each command has a description', () => {
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

    for (const cmd of program.commands) {
      expect(cmd.description(), `${cmd.name()} should have a description`).toBeTruthy();
    }
  });
});
