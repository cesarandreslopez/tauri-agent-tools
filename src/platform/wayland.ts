import type { ImageFormat, PlatformAdapter, WindowInfo } from '../types.js';
import { exec } from '../util/exec.js';
import { SwayNodeSchema } from '../schemas.js';
import type { SwayNode } from '../schemas.js';

function findInTree(node: SwayNode, title: string): SwayNode | null {
  if (node.name && node.name.includes(title)) return node;
  for (const child of node.nodes ?? []) {
    const found = findInTree(child, title);
    if (found) return found;
  }
  for (const child of node.floating_nodes ?? []) {
    const found = findInTree(child, title);
    if (found) return found;
  }
  return null;
}

export class WaylandAdapter implements PlatformAdapter {
  async findWindow(title: string): Promise<string> {
    const { stdout } = await exec('swaymsg', ['-t', 'get_tree', '-r']);
    const tree = SwayNodeSchema.parse(JSON.parse(stdout.toString()));
    const node = findInTree(tree, title);
    if (!node) {
      throw new Error(`No window found matching: ${title}`);
    }
    return String(node.id);
  }

  async captureWindow(windowId: string, format: ImageFormat): Promise<Buffer> {
    // On Wayland, we capture the window region using grim
    const geom = await this.getWindowGeometry(windowId);
    const region = `${geom.x},${geom.y} ${geom.width}x${geom.height}`;
    const fmt = format === 'jpg' ? 'jpeg' : 'png';
    const { stdout } = await exec('grim', ['-g', region, '-t', fmt, '-']);
    return stdout;
  }

  async getWindowGeometry(windowId: string): Promise<WindowInfo> {
    const { stdout } = await exec('swaymsg', ['-t', 'get_tree', '-r']);
    const tree = SwayNodeSchema.parse(JSON.parse(stdout.toString()));
    const node = this._findById(tree, parseInt(windowId, 10));
    if (!node) {
      throw new Error(`Window ${windowId} not found in sway tree`);
    }
    return {
      windowId,
      name: node.name ?? undefined,
      x: node.rect.x,
      y: node.rect.y,
      width: node.rect.width,
      height: node.rect.height,
    };
  }

  async getWindowName(windowId: string): Promise<string> {
    const geom = await this.getWindowGeometry(windowId);
    return geom.name ?? '';
  }

  async listWindows(): Promise<WindowInfo[]> {
    const { stdout } = await exec('swaymsg', ['-t', 'get_tree', '-r']);
    const tree = SwayNodeSchema.parse(JSON.parse(stdout.toString()));
    const leaves: SwayNode[] = [];
    this._collectLeaves(tree, leaves);

    return leaves
      .filter((n) => n.name)
      .map((n) => ({
        windowId: String(n.id),
        pid: n.pid,
        name: n.name ?? undefined,
        x: n.rect.x,
        y: n.rect.y,
        width: n.rect.width,
        height: n.rect.height,
      }));
  }

  private _collectLeaves(node: SwayNode, out: SwayNode[]): void {
    const children = [...(node.nodes ?? []), ...(node.floating_nodes ?? [])];
    if (children.length === 0 && node.name) {
      out.push(node);
      return;
    }
    for (const child of children) {
      this._collectLeaves(child, out);
    }
  }

  private _findById(node: SwayNode, id: number): SwayNode | null {
    if (node.id === id) return node;
    for (const child of node.nodes ?? []) {
      const found = this._findById(child, id);
      if (found) return found;
    }
    for (const child of node.floating_nodes ?? []) {
      const found = this._findById(child, id);
      if (found) return found;
    }
    return null;
  }
}
