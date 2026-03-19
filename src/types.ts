export type { ElementRect, BridgeConfig, RustLogEntry } from './schemas.js';

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

export type ImageFormat = 'png' | 'jpg';

export interface PlatformAdapter {
  findWindow(title: string): Promise<string>;
  captureWindow(windowId: string, format: ImageFormat): Promise<Buffer>;
  getWindowGeometry(windowId: string): Promise<WindowInfo>;
  getWindowName(windowId: string): Promise<string>;
  listWindows(): Promise<WindowInfo[]>;
}

export interface WindowListEntry extends WindowInfo {
  tauri: boolean;
  bridge?: import('./schemas.js').BridgeConfig;
}
