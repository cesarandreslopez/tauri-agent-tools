import type { ElementRect } from '../schemas/bridge.js';
import type { ImageFormat } from '../schemas/commands.js';
import { exec } from './exec.js';
import { magickCommand } from './magick.js';

export async function cropImage(
  buffer: Buffer,
  rect: ElementRect,
  format: ImageFormat,
): Promise<Buffer> {
  const fmt = format === 'jpg' ? 'jpg' : 'png';
  const crop = `${Math.round(rect.width)}x${Math.round(rect.height)}+${Math.round(rect.x)}+${Math.round(rect.y)}`;
  const cmd = await magickCommand('convert');
  const { stdout } = await exec(
    cmd.bin,
    [...cmd.args, `${fmt}:-`, '-crop', crop, '+repage', `${fmt}:-`],
    { stdin: buffer },
  );
  return stdout;
}

export async function resizeImage(
  buffer: Buffer,
  maxWidth: number,
  format: ImageFormat,
): Promise<Buffer> {
  const fmt = format === 'jpg' ? 'jpg' : 'png';
  const cmd = await magickCommand('convert');
  const { stdout } = await exec(
    cmd.bin,
    [...cmd.args, `${fmt}:-`, '-resize', `${maxWidth}x>`, `${fmt}:-`],
    { stdin: buffer },
  );
  return stdout;
}

export function computeCropRect(
  elementRect: ElementRect,
  viewport: { width: number; height: number },
  windowGeometry: { width: number; height: number },
): ElementRect {
  const decorX = windowGeometry.width - viewport.width;
  const decorY = windowGeometry.height - viewport.height;
  return {
    x: decorX + elementRect.x,
    y: decorY + elementRect.y,
    width: elementRect.width,
    height: elementRect.height,
  };
}
