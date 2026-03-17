import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageFormat, PlatformAdapter, WindowInfo } from '../types.js';
import { exec, validateWindowId } from '../util/exec.js';

interface CGWindowInfo {
  kCGWindowNumber: number;
  kCGWindowName?: string;
  kCGWindowOwnerName?: string;
  kCGWindowBounds: { X: number; Y: number; Width: number; Height: number };
}

function escapeJxaString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function runJxa(script: string): Promise<string> {
  const { stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', script]);
  return stdout.toString().trim();
}

async function getWindowList(): Promise<CGWindowInfo[]> {
  const script = `
ObjC.import('CoreGraphics');
var list = ObjC.deepUnwrap(
  $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)
);
JSON.stringify(list.map(function(w) {
  return {
    kCGWindowNumber: w.kCGWindowNumber,
    kCGWindowName: w.kCGWindowName || '',
    kCGWindowOwnerName: w.kCGWindowOwnerName || '',
    kCGWindowBounds: w.kCGWindowBounds
  };
}));`;

  const raw = await runJxa(script);
  const windows: CGWindowInfo[] = JSON.parse(raw);

  // Detect Screen Recording permission issue: all names empty
  const hasAnyName = windows.some(
    (w) => (w.kCGWindowName && w.kCGWindowName.length > 0) ||
           (w.kCGWindowOwnerName && w.kCGWindowOwnerName.length > 0),
  );
  if (windows.length > 0 && !hasAnyName) {
    throw new Error(
      'Screen Recording permission required. Grant access in System Settings → Privacy & Security → Screen Recording, then restart your terminal.',
    );
  }

  return windows;
}

async function normalizeRetina(filePath: string, logicalWidth: number): Promise<void> {
  const { stdout } = await exec('sips', ['-g', 'pixelWidth', filePath]);
  const match = stdout.toString().match(/pixelWidth:\s*(\d+)/);
  if (!match) return;

  const pixelWidth = parseInt(match[1], 10);
  if (pixelWidth > logicalWidth) {
    await exec('sips', ['--resampleWidth', String(logicalWidth), filePath]);
  }
}

export class MacOSAdapter implements PlatformAdapter {
  async findWindow(title: string): Promise<string> {
    const windows = await getWindowList();
    const escaped = escapeJxaString(title);
    // Use the unescaped title for matching — escapeJxaString is for JXA embedding only
    const match = windows.find(
      (w) => (w.kCGWindowName && w.kCGWindowName.includes(title)) ||
             (w.kCGWindowOwnerName && w.kCGWindowOwnerName.includes(title)),
    );
    if (!match) {
      throw new Error(`No window found matching: ${title}`);
    }
    return String(match.kCGWindowNumber);
  }

  async captureWindow(windowId: string, format: ImageFormat): Promise<Buffer> {
    validateWindowId(windowId);

    const tmpDir = await mkdtemp(join(tmpdir(), 'tauri-cap-'));
    const ext = format === 'jpg' ? 'jpg' : 'png';
    const tmpFile = join(tmpDir, `capture.${ext}`);

    try {
      // -l captures specific window by CGWindowID, -o disables shadow, -x disables sound
      await exec('screencapture', ['-l', windowId, '-o', '-x', tmpFile]);

      // Get logical window width for Retina normalization
      const geom = await this.getWindowGeometry(windowId);
      await normalizeRetina(tmpFile, geom.width);

      // Convert to jpg if requested (screencapture always writes png with -l)
      if (format === 'jpg') {
        await exec('sips', ['-s', 'format', 'jpeg', tmpFile, '--out', tmpFile]);
      }

      return await readFile(tmpFile);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async getWindowGeometry(windowId: string): Promise<WindowInfo> {
    validateWindowId(windowId);

    const windows = await getWindowList();
    const id = parseInt(windowId, 10);
    const win = windows.find((w) => w.kCGWindowNumber === id);
    if (!win) {
      throw new Error(`Window ${windowId} not found`);
    }

    return {
      windowId,
      name: win.kCGWindowName || win.kCGWindowOwnerName || undefined,
      x: win.kCGWindowBounds.X,
      y: win.kCGWindowBounds.Y,
      width: win.kCGWindowBounds.Width,
      height: win.kCGWindowBounds.Height,
    };
  }

  async getWindowName(windowId: string): Promise<string> {
    const geom = await this.getWindowGeometry(windowId);
    return geom.name ?? '';
  }
}
