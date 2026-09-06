import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { exec, ExecError } from '../../src/util/exec.js';
import { stat } from 'node:fs/promises';
import { registerDiff } from '../../src/commands/diff.js';

vi.mock('../../src/util/exec.js', async importOriginal => ({ ...await importOriginal(), exec: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: vi.fn() }));
vi.mock('../../src/util/magick.js', () => ({ magickCommand: vi.fn(async (sub: string) => ({ bin: sub, args: [] })) }));
const initialExitCode = process.exitCode;
let metric = '0';
let compareError: Error | undefined;
let secondDimensions = '1000 1000';
beforeEach(() => {
  metric='0';compareError=undefined;secondDimensions='1000 1000';
  vi.mocked(stat).mockResolvedValue({} as never);
  vi.mocked(exec).mockImplementation(async (cmd,args) => {
    if (cmd === 'identify') return { stdout: Buffer.from(args.at(-1)==='b.png' ? secondDimensions : '1000 1000'), stderr:'' };
    if (compareError) throw compareError;
    return {stdout:Buffer.alloc(0),stderr:metric};
  });
});
afterEach(() => {vi.restoreAllMocks();process.exitCode=initialExitCode;});
function run(extra: string[] = []) {
  const command=new Command().exitOverride();registerDiff(command);
  return command.parseAsync(['node','fixture','diff','a.png','b.png',...extra]);
}

describe('diff outcomes', () => {
  it('formats the actual command result', async () => {
    const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    await run();
    expect(output).toHaveBeenCalledWith(expect.stringContaining('Difference:       0.000%'));
  });
  it.each(['1000000','1e+06','1e+06 (1)'])('reads a complete difference from %s', async value => {
    compareError=new ExecError('compare differs',1,Buffer.alloc(0),value);
    const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    await run(['--threshold','1','--json']);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({pixelsDifferent:1000000,percentDifferent:100,totalPixels:1000000});
    expect(process.exitCode).toBe(1);
  });
  it('does not misread a failed process as a pixel count', async () => {
    compareError=new ExecError('Cannot write image at path123',2,Buffer.alloc(0),'1e+06 (1)\nwrite failed at path123');
    await expect(run(['-o','missing123/diff.png'])).rejects.toBe(compareError);
  });
  it.each(['', 'garbage123', '1000001', 'NaN'])('rejects an invalid metric %s', async value => {
    metric=value;await expect(run()).rejects.toThrow('Invalid ImageMagick AE metric');
  });
  it('rejects mismatched image dimensions', async () => {
    secondDimensions='10 10';await expect(run()).rejects.toThrow('Image dimensions differ');
  });
  it.each(['oops','1percent','-1','101','Infinity'])('rejects threshold %s before reading files', async value => {
    vi.mocked(stat).mockClear();await expect(run(['--threshold',value])).rejects.toThrow();expect(stat).not.toHaveBeenCalled();
  });
  it('handles missing images', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));await expect(run()).rejects.toThrow('File not found');
  });
  it('preserves below-threshold success', async () => {
    metric='500';vi.spyOn(console,'log').mockImplementation(()=>{});await run(['--threshold','1']);expect(process.exitCode).toBe(initialExitCode);
  });
});
