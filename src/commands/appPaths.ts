import { Command } from 'commander';
import { existsSync, statSync } from 'node:fs';
import { currentPlatform, resolveTauriPaths, resolveTauriProject } from '../util/tauriConfig.js';

interface AppPathsOpts {
  config?: string;
  identifier?: string;
  platform?: string;
  json?: boolean;
  exists?: boolean;
}

export function registerAppPaths(program: Command): void {
  const cmd = new Command('app-paths')
    .description('Resolve a Tauri 2 app\'s OS data/log/cache/config directories')
    .option('--config <path>', 'Path to tauri.conf.json (or its directory). Auto-detected if omitted.')
    .option('--identifier <id>', 'Bundle identifier override (skips tauri.conf.json identifier lookup)')
    .option(
      '--platform <name>',
      'Platform to resolve for: darwin | linux | win32 | all (default: current host)',
    )
    .option('--exists', 'Annotate each path with whether it currently exists on disk')
    .option('--json', 'Output as JSON')
    .action(async (opts: AppPathsOpts) => {
      const platform = (opts.platform ?? currentPlatform()).toLowerCase();
      if (!['darwin', 'linux', 'win32', 'all'].includes(platform)) {
        throw new Error(
          `Invalid --platform: ${opts.platform}. Expected one of: darwin, linux, win32, all.`,
        );
      }

      // Identifier-only mode: skip tauri.conf.json discovery entirely. Useful when
      // the user only wants to compute paths from a known bundle id (e.g., a release
      // build with no source tree on disk).
      if (opts.identifier && !opts.config) {
        const allPaths = resolveTauriPaths(opts.identifier);
        emit(
          {
            identifier: opts.identifier,
            productName: null,
            configPath: null,
            platform: platform === 'all' ? null : platform,
            paths:
              platform === 'all'
                ? allPaths
                : { [platform as 'darwin' | 'linux' | 'win32']: allPaths[platform as 'darwin' | 'linux' | 'win32'] },
          },
          opts,
        );
        return;
      }

      const resolved = await resolveTauriProject({
        configPath: opts.config,
        identifierOverride: opts.identifier,
      });

      const paths =
        platform === 'all'
          ? resolved.paths
          : { [platform as 'darwin' | 'linux' | 'win32']: resolved.paths[platform as 'darwin' | 'linux' | 'win32'] };

      emit(
        {
          identifier: resolved.identifier,
          productName: resolved.productName,
          configPath: resolved.configPath,
          platform: platform === 'all' ? null : platform,
          paths,
        },
        opts,
      );
    });

  program.addCommand(cmd);
}

interface AppPathsOutput {
  identifier: string;
  productName: string | null;
  configPath: string | null;
  platform: string | null;
  paths: Record<string, Record<string, string>>;
}

function emit(out: AppPathsOutput, opts: AppPathsOpts): void {
  if (opts.exists) {
    out = annotateExistence(out);
  }
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`Identifier:   ${out.identifier}`);
  if (out.productName) console.log(`Product name: ${out.productName}`);
  if (out.configPath) console.log(`Config:       ${out.configPath}`);
  for (const [plat, pathSet] of Object.entries(out.paths)) {
    console.log(`\n[${plat}]`);
    for (const [key, value] of Object.entries(pathSet)) {
      console.log(`  ${key.padEnd(16)} ${value}`);
    }
  }
}

/**
 * Add `__exists` annotations alongside each path string. Only checks paths that
 * point at the *current* platform (it makes no sense to test if a Windows path
 * exists from inside macOS).
 */
function annotateExistence(out: AppPathsOutput): AppPathsOutput {
  const current = currentPlatform();
  const annotated: Record<string, Record<string, string>> = {};
  for (const [plat, pathSet] of Object.entries(out.paths)) {
    if (plat !== current) {
      annotated[plat] = pathSet;
      continue;
    }
    const inflated: Record<string, string> = {};
    for (const [key, value] of Object.entries(pathSet)) {
      const exists = existsSync(value);
      const detail = exists
        ? statSync(value).isDirectory()
          ? ' (dir exists)'
          : ' (file exists)'
        : ' (missing)';
      inflated[key] = `${value}${detail}`;
    }
    annotated[plat] = inflated;
  }
  return { ...out, paths: annotated };
}
