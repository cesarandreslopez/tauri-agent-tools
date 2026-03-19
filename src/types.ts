import type { ImageFormat } from './schemas/commands.js';
import type { BridgeConfig } from './schemas/bridge.js';

export interface WindowInfo {
  windowId: string;
  pid?: number;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DisplayServer = 'x11' | 'wayland' | 'darwin' | 'unknown';

export interface PlatformAdapter {
  findWindow(title: string): Promise<string>;
  captureWindow(windowId: string, format: ImageFormat): Promise<Buffer>;
  getWindowGeometry(windowId: string): Promise<WindowInfo>;
  getWindowName(windowId: string): Promise<string>;
  listWindows(): Promise<WindowInfo[]>;
}

export interface WindowListEntry extends WindowInfo {
  tauri: boolean;
  bridge?: BridgeConfig;
}
