import type { ElementRect, ImageFormat } from '../types.js';
import { exec } from './exec.js';

export async function cropImage(
  buffer: Buffer,
  rect: ElementRect,
  format: ImageFormat,
): Promise<Buffer> {
  const fmt = format === 'jpg' ? 'jpg' : 'png';
  const crop = `${Math.round(rect.width)}x${Math.round(rect.height)}+${Math.round(rect.x)}+${Math.round(rect.y)}`;
  const { stdout } = await exec(
    'convert',
    [`${fmt}:-`, '-crop', crop, '+repage', `${fmt}:-`],
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
  const { stdout } = await exec(
    'convert',
    [`${fmt}:-`, '-resize', `${maxWidth}x\\>`, `${fmt}:-`],
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
