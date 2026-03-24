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

async function checkImageMagick(installHint: string): Promise<ToolCheck> {
  // ImageMagick v7 uses a unified `magick` binary; v6 has standalone commands
  const hasMagick = await commandExists('magick');
  if (hasMagick) {
    return { name: 'magick (ImageMagick)', available: true, installHint };
  }
  const hasConvert = await commandExists('convert');
  return { name: 'magick (ImageMagick)', available: hasConvert, installHint };
}

export async function checkX11Tools(): Promise<ToolCheck[]> {
  const [xdotool, magick] = await Promise.all([
    commandExists('xdotool').then((available) => ({
      name: 'xdotool',
      available,
      installHint: 'sudo apt install xdotool',
    })),
    checkImageMagick('sudo apt install imagemagick'),
  ]);
  return [xdotool, magick];
}

export async function checkSwayTools(): Promise<ToolCheck[]> {
  const [swaymsg, grim, magick] = await Promise.all([
    commandExists('swaymsg').then((available) => ({
      name: 'swaymsg',
      available,
      installHint: 'sudo apt install sway',
    })),
    commandExists('grim').then((available) => ({
      name: 'grim',
      available,
      installHint: 'sudo apt install grim',
    })),
    checkImageMagick('sudo apt install imagemagick'),
  ]);
  return [swaymsg, grim, magick];
}

export async function checkHyprlandTools(): Promise<ToolCheck[]> {
  const [hyprctl, grim, magick] = await Promise.all([
    commandExists('hyprctl').then((available) => ({
      name: 'hyprctl',
      available,
      installHint: 'Included with Hyprland',
    })),
    commandExists('grim').then((available) => ({
      name: 'grim',
      available,
      installHint: 'sudo apt install grim',
    })),
    checkImageMagick('sudo apt install imagemagick'),
  ]);
  return [hyprctl, grim, magick];
}

export async function checkMacOSTools(): Promise<ToolCheck[]> {
  const [screencapture, osascript, sips, magick] = await Promise.all([
    commandExists('screencapture').then((available) => ({
      name: 'screencapture',
      available,
      installHint: 'Built-in on macOS',
    })),
    commandExists('osascript').then((available) => ({
      name: 'osascript',
      available,
      installHint: 'Built-in on macOS',
    })),
    commandExists('sips').then((available) => ({
      name: 'sips',
      available,
      installHint: 'Built-in on macOS',
    })),
    checkImageMagick('brew install imagemagick'),
  ]);
  return [screencapture, osascript, sips, magick];
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
