import { stat } from 'node:fs/promises';
import { Command } from 'commander';
import { z } from 'zod';
import { exec } from '../util/exec.js';
import { magickCommand } from '../util/magick.js';

interface DiffResult {
  pixelsDifferent: number;
  totalPixels: number;
  percentDifferent: number;
  diffImage: string | null;
}

function formatResult(result: DiffResult): string {
  const lines = [
    `Pixels different: ${result.pixelsDifferent}`,
    `Total pixels:     ${result.totalPixels}`,
    `Difference:       ${result.percentDifferent.toFixed(3)}%`,
  ];
  if (result.diffImage) {
    lines.push(`Diff image:       ${result.diffImage}`);
  }
  return lines.join('\n');
}

export function registerDiff(program: Command): void {
  const cmd = new Command('diff')
    .description('Compare two screenshots and output difference metrics')
    .argument('<image1>', 'First image path')
    .argument('<image2>', 'Second image path')
    .option('-o, --output <path>', 'Diff image output path')
    .option('--threshold <percent>', 'Fail (exit code 1) if difference exceeds this percentage', parseFloat)
    .option('--json', 'Output structured JSON');

  cmd.action(async (image1: string, image2: string, opts: {
    output?: string;
    threshold?: number;
    json?: boolean;
  }) => {
    // Verify files exist
    for (const img of [image1, image2]) {
      try {
        await stat(img);
      } catch {
        throw new Error(`File not found: ${img}`);
      }
    }

    // Get image dimensions for total pixel count
    let totalPixels = 0;
    try {
      const identifyCmd = await magickCommand('identify');
      const { stdout } = await exec(identifyCmd.bin, [...identifyCmd.args, '-format', '%w %h', image1]);
      const [w, h] = z.tuple([z.number().int().positive(), z.number().int().positive()]).parse(
        stdout.toString().trim().split(' ').map(Number),
      );
      totalPixels = w * h;
    } catch {
      if (opts.threshold !== undefined) {
        throw new Error('Cannot compute percentage: `identify` failed to read image dimensions');
      }
    }

    // Compare images
    const diffOutput = opts.output ?? '/dev/null';
    let pixelsDifferent = 0;

    try {
      // compare exits with code 1 when images differ (not an error)
      const compareCmd = await magickCommand('compare');
      const { stderr } = await exec(compareCmd.bin, [
        ...compareCmd.args,
        '-metric', 'AE',
        image1,
        image2,
        diffOutput,
      ]);
      pixelsDifferent = parseInt(stderr.trim(), 10) || 0;
    } catch (err: unknown) {
      // ImageMagick `compare` exits 1 when images differ — parse stderr
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/(\d+)/);
      if (match) {
        pixelsDifferent = parseInt(match[1]!, 10);
      } else {
        throw err;
      }
    }

    const percentDifferent = totalPixels > 0
      ? (pixelsDifferent / totalPixels) * 100
      : 0;

    const result: DiffResult = {
      pixelsDifferent,
      totalPixels,
      percentDifferent,
      diffImage: opts.output ?? null,
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result));
    }

    if (opts.threshold !== undefined && percentDifferent > opts.threshold) {
      process.exitCode = 1;
    }
  });

  program.addCommand(cmd);
}
