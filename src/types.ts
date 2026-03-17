export interface WindowInfo {
  windowId: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BridgeConfig {
  port: number;
  token: string;
}

export type DisplayServer = 'x11' | 'wayland' | 'unknown';

export type ImageFormat = 'png' | 'jpg';

export interface PlatformAdapter {
  findWindow(title: string): Promise<string>;
  captureWindow(windowId: string, format: ImageFormat): Promise<Buffer>;
  getWindowGeometry(windowId: string): Promise<WindowInfo>;
  getWindowName(windowId: string): Promise<string>;
}
