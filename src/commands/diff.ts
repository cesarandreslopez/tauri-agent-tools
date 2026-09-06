import { stat } from 'node:fs/promises';
import { Command } from 'commander';
import { z } from 'zod';
import { exec, ExecError } from '../util/exec.js';
import { magickCommand } from '../util/magick.js';
import { parsePercent } from './shared.js';

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
    .option('--threshold <percent>', 'Fail (exit code 1) if difference exceeds this percentage', parsePercent)
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

    const identifyCmd = await magickCommand('identify');
    const dimensions = [];
    for (const img of [image1, image2]) {
      const { stdout } = await exec(identifyCmd.bin, [...identifyCmd.args, '-format', '%w %h', img]);
      dimensions.push(z.tuple([z.number().int().positive(), z.number().int().positive()]).parse(
        stdout.toString().trim().split(/\s+/).map(Number),
      ));
    }
    const [w, h] = dimensions[0]!;
    if (w !== dimensions[1]![0] || h !== dimensions[1]![1]) {
      throw new Error('Image dimensions differ. Compare screenshots with matching dimensions.');
    }
    const totalPixels = w * h;
    const compareCmd = await magickCommand('compare');
    let metric: string;
    try {
      const result = await exec(compareCmd.bin, [
        ...compareCmd.args, '-metric', 'AE', image1, image2, opts.output ?? 'null:',
      ]);
      metric = result.stderr;
    } catch (error) {
      // Only exit 1 represents a valid comparison with different pixels.
      if (!(error instanceof ExecError) || error.code !== 1) throw error;
      metric = error.stderr;
    }
    const match = metric.trim().match(/^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s+\([^)]*\))?$/i);
    const pixelsDifferent = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(pixelsDifferent) || pixelsDifferent < 0 || pixelsDifferent > totalPixels) {
      throw new Error(`Invalid ImageMagick AE metric: ${metric.trim()}`);
    }
    const percentDifferent = pixelsDifferent / totalPixels * 100;

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
