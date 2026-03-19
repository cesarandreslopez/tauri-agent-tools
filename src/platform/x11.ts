import type { PlatformAdapter, WindowInfo } from '../types.js';
import type { ImageFormat } from '../schemas/commands.js';
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

  async listWindows(): Promise<WindowInfo[]> {
    const { stdout } = await exec('xdotool', ['search', '--name', '']);
    const ids = stdout.toString().trim().split('\n').filter(Boolean);

    const windows: WindowInfo[] = [];
    for (const id of ids) {
      try {
        const [nameResult, geomResult, pidResult] = await Promise.all([
          exec('xdotool', ['getwindowname', id]),
          exec('xdotool', ['getwindowgeometry', '--shell', id]),
          exec('xdotool', ['getwindowpid', id]),
        ]);

        const name = nameResult.stdout.toString().trim();
        if (!name) continue;

        const geomOutput = geomResult.stdout.toString();
        const parse = (key: string): number => {
          const match = geomOutput.match(new RegExp(`${key}=(\\d+)`));
          return match ? parseInt(match[1], 10) : 0;
        };

        const pid = parseInt(pidResult.stdout.toString().trim(), 10);

        windows.push({
          windowId: id,
          pid: isNaN(pid) ? undefined : pid,
          name,
          x: parse('X'),
          y: parse('Y'),
          width: parse('WIDTH'),
          height: parse('HEIGHT'),
        });
      } catch {
        // Skip windows that disappeared or can't be queried
        continue;
      }
    }

    return windows;
  }
}
