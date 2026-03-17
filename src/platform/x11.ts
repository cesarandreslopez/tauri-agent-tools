import type { ImageFormat, PlatformAdapter, WindowInfo } from '../types.js';
import { exec, validateWindowId } from '../util/exec.js';

export class X11Adapter implements PlatformAdapter {
  async findWindow(title: string): Promise<string> {
    const { stdout } = await exec('xdotool', ['search', '--name', title]);
    const ids = stdout.toString().trim().split('\n').filter(Boolean);
    if (ids.length === 0) {
      throw new Error(`No window found matching: ${title}`);
    }
    return ids[0];
  }

  async captureWindow(windowId: string, format: ImageFormat): Promise<Buffer> {
    validateWindowId(windowId);
    const fmt = format === 'jpg' ? 'jpg' : 'png';
    const { stdout } = await exec('import', ['-window', windowId, `${fmt}:-`]);
    return stdout;
  }

  async getWindowGeometry(windowId: string): Promise<WindowInfo> {
    validateWindowId(windowId);
    const { stdout } = await exec('xdotool', ['getwindowgeometry', '--shell', windowId]);
    const output = stdout.toString();

    const parse = (key: string): number => {
      const match = output.match(new RegExp(`${key}=(\\d+)`));
      if (!match) throw new Error(`Failed to parse ${key} from xdotool output`);
      return parseInt(match[1], 10);
    };

    return {
      windowId,
      x: parse('X'),
      y: parse('Y'),
      width: parse('WIDTH'),
      height: parse('HEIGHT'),
    };
  }

  async getWindowName(windowId: string): Promise<string> {
    validateWindowId(windowId);
    const { stdout } = await exec('xdotool', ['getwindowname', windowId]);
    return stdout.toString().trim();
  }
}
