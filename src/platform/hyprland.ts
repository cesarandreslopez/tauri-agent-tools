import type { PlatformAdapter, WindowInfo } from '../types.js';
import type { ImageFormat } from '../schemas/commands.js';
import { exec } from '../util/exec.js';
import { HyprClientListSchema } from '../schemas/platform.js';
import type { HyprClient } from '../schemas/platform.js';

export class HyprlandAdapter implements PlatformAdapter {
  async findWindow(title: string): Promise<string> {
    const clients = await this._getClients();
    const match = clients.find(
      (c) => c.mapped && !c.hidden && c.title.includes(title),
    );
    if (!match) {
      throw new Error(`No window found matching: ${title}`);
    }
    return match.address;
  }

  async captureWindow(windowId: string, format: ImageFormat): Promise<Buffer> {
    const geom = await this.getWindowGeometry(windowId);
    const region = `${geom.x},${geom.y} ${geom.width}x${geom.height}`;
    const fmt = format === 'jpg' ? 'jpeg' : 'png';
    const { stdout } = await exec('grim', ['-g', region, '-t', fmt, '-']);
    return stdout;
  }

  async getWindowGeometry(windowId: string): Promise<WindowInfo> {
    const clients = await this._getClients();
    const client = clients.find((c) => c.address === windowId);
    if (!client) {
      throw new Error(`Window ${windowId} not found`);
    }
    return this._toWindowInfo(client);
  }

  async getWindowName(windowId: string): Promise<string> {
    const geom = await this.getWindowGeometry(windowId);
    return geom.name ?? '';
  }

  async listWindows(): Promise<WindowInfo[]> {
    const clients = await this._getClients();
    return clients.filter((c) => c.mapped && !c.hidden).map((c) => this._toWindowInfo(c));
  }

  private async _getClients(): Promise<HyprClient[]> {
    const { stdout } = await exec('hyprctl', ['clients', '-j']);
    return HyprClientListSchema.parse(JSON.parse(stdout.toString()));
  }

  private _toWindowInfo(client: HyprClient): WindowInfo {
    return {
      windowId: client.address,
      pid: client.pid,
      name: client.title || undefined,
      x: client.at[0],
      y: client.at[1],
      width: client.size[0],
      height: client.size[1],
    };
  }
}
