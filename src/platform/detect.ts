import { execFile } from 'node:child_process';
import type { DisplayServer } from '../types.js';

export function detectDisplayServer(): DisplayServer {
  if (process.platform === 'darwin') return 'darwin';

  const isWayland = !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
  if (isWayland) {
    if (process.env.SWAYSOCK) return 'wayland-sway';
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return 'wayland-hyprland';
    return 'wayland';
  }

  if (process.env.DISPLAY) return 'x11';
  if (process.env.XDG_SESSION_TYPE === 'x11') return 'x11';

  return 'unknown';
}

function commandExists(cmd: string): Promise<boolean> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(which, [cmd], (error) => resolve(!error));
  });
}

export interface ToolCheck {
  name: string;
  available: boolean;
  installHint: string;
}

export async function checkX11Tools(): Promise<ToolCheck[]> {
  const tools: Array<{ name: string; installHint: string }> = [
    { name: 'xdotool', installHint: 'sudo apt install xdotool' },
    { name: 'import', installHint: 'sudo apt install imagemagick' },
    { name: 'convert', installHint: 'sudo apt install imagemagick' },
  ];

  return Promise.all(
    tools.map(async (t) => ({
      ...t,
      available: await commandExists(t.name),
    })),
  );
}

export async function checkSwayTools(): Promise<ToolCheck[]> {
  const tools: Array<{ name: string; installHint: string }> = [
    { name: 'swaymsg', installHint: 'sudo apt install sway' },
    { name: 'grim', installHint: 'sudo apt install grim' },
    { name: 'convert', installHint: 'sudo apt install imagemagick' },
  ];

  return Promise.all(
    tools.map(async (t) => ({
      ...t,
      available: await commandExists(t.name),
    })),
  );
}

export async function checkHyprlandTools(): Promise<ToolCheck[]> {
  const tools: Array<{ name: string; installHint: string }> = [
    { name: 'hyprctl', installHint: 'Included with Hyprland' },
    { name: 'grim', installHint: 'sudo apt install grim' },
    { name: 'convert', installHint: 'sudo apt install imagemagick' },
  ];

  return Promise.all(
    tools.map(async (t) => ({
      ...t,
      available: await commandExists(t.name),
    })),
  );
}

export async function checkMacOSTools(): Promise<ToolCheck[]> {
  const tools: Array<{ name: string; installHint: string }> = [
    { name: 'screencapture', installHint: 'Built-in on macOS' },
    { name: 'osascript', installHint: 'Built-in on macOS' },
    { name: 'sips', installHint: 'Built-in on macOS' },
    { name: 'convert', installHint: 'brew install imagemagick' },
  ];

  return Promise.all(
    tools.map(async (t) => ({
      ...t,
      available: await commandExists(t.name),
    })),
  );
}

export async function ensureTools(displayServer: DisplayServer): Promise<void> {
  let checks: ToolCheck[];
  if (displayServer === 'darwin') {
    checks = await checkMacOSTools();
  } else if (displayServer === 'wayland-sway') {
    checks = await checkSwayTools();
  } else if (displayServer === 'wayland-hyprland') {
    checks = await checkHyprlandTools();
  } else if (displayServer === 'wayland') {
    // Generic Wayland — try sway tools as fallback
    checks = await checkSwayTools();
  } else {
    checks = await checkX11Tools();
  }

  const missing = checks.filter((t) => !t.available);
  if (missing.length > 0) {
    const hints = missing.map((t) => `  ${t.name}: ${t.installHint}`).join('\n');
    throw new Error(`Missing required tools:\n${hints}`);
  }
}
