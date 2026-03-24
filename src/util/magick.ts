import { execFile } from 'node:child_process';

/**
 * ImageMagick command resolver.
 *
 * v6: standalone commands — `convert`, `import`, `identify`, `compare`
 * v7: unified binary    — `magick convert`, `magick import`, etc.
 *     (`magick` alone acts as `convert`)
 */

export interface MagickCommand {
  bin: string;
  args: string[];
}

let cachedVersion: 6 | 7 | null = null;

function commandExists(cmd: string): Promise<boolean> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(which, [cmd], (error) => resolve(!error));
  });
}

export async function detectMagickVersion(): Promise<6 | 7> {
  if (cachedVersion !== null) return cachedVersion;

  if (await commandExists('magick')) {
    cachedVersion = 7;
  } else if (await commandExists('convert')) {
    cachedVersion = 6;
  } else {
    throw new Error(
      'ImageMagick not found. Install it:\n' +
        '  Linux:  sudo apt install imagemagick  (or your distro equivalent)\n' +
        '  macOS:  brew install imagemagick',
    );
  }

  return cachedVersion;
}

/**
 * Resolve an ImageMagick subcommand to the correct bin + args prefix.
 *
 * v7: `magick` alone replaces `convert`; other subcommands use `magick <sub>`
 * v6: standalone commands — `convert`, `import`, `identify`, `compare`
 */
export async function magickCommand(
  subcommand: 'convert' | 'import' | 'identify' | 'compare',
): Promise<MagickCommand> {
  const version = await detectMagickVersion();

  if (version === 7) {
    // In v7, `magick` alone IS convert; other tools need the subcommand
    if (subcommand === 'convert') {
      return { bin: 'magick', args: [] };
    }
    return { bin: 'magick', args: [subcommand] };
  }

  return { bin: subcommand, args: [] };
}

/** Reset cached version (for testing). */
export function _resetMagickCache(): void {
  cachedVersion = null;
}
