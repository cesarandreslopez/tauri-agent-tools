import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { exec } from '../../src/util/exec.js';
import { registerBundle } from '../../src/commands/bundle.js';
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), spawn: vi.fn() }));
vi.mock('../../src/util/exec.js', async importOriginal => ({ ...await importOriginal(), exec: vi.fn() }));
const realExec = (await vi.importActual<typeof import('../../src/util/exec.js')>('../../src/util/exec.js')).exec;
let root: string;
let sabotage: ((dir: string) => void) | undefined;
let collected: string[];
let output: ReturnType<typeof vi.spyOn>;
const initialExitCode=process.exitCode;
function run(extra:string[]=[]) {
 const program=new Command().exitOverride(); registerBundle(program);
 return program.parseAsync(['node','fixture','bundle','--out',join(root,'incident'),'--json',...extra]);
}
beforeEach(() => {
 vi.clearAllMocks();
 root=mkdtempSync(join(tmpdir(),'bundle-test-')); collected=[]; sabotage=undefined;
 output=vi.spyOn(console,'log').mockImplementation(()=>{});
 vi.mocked(exec).mockImplementation(realExec);
 vi.mocked(spawn).mockImplementation((_command,args) => {
  const phase=String(args![1]);
  if (phase==='capture' || phase==='forensics') {
   const dir=String(args![args!.indexOf('-o')+1]); mkdirSync(dir,{recursive:true});collected.push(dir);
   if (phase==='capture') {
    writeFileSync(join(dir,'manifest.json'),JSON.stringify({errorCount:0,files:{}}));
    writeFileSync(join(dir,'storage.json'),JSON.stringify({localStorage:[{key:'authToken',value:'opaque_fixture_secret'}]}));
    writeFileSync(join(dir,'screenshot.png'),'image fixture');
    sabotage?.(dir);
   } else writeFileSync(join(dir,'summary.json'),JSON.stringify({phases:[]}));
  }
  const child=Object.assign(new EventEmitter(),{
   stdout:Object.assign(new EventEmitter(),{setEncoding:vi.fn()}),
   stderr:Object.assign(new EventEmitter(),{setEncoding:vi.fn()}),
  });
  queueMicrotask(()=>{
   child.stdout.emit('data',JSON.stringify({phase,token:'fixture-secret'})+'\n');child.emit('close',0);
  });
  return child as never;
 });
});
afterEach(() => {vi.restoreAllMocks();rmSync(root,{recursive:true,force:true});process.exitCode=initialExitCode;});

describe('bundle publication', () => {
 it('records archive publication failure without following the destination symlink', async () => {
  const target=join(root,'keep.tar.gz');writeFileSync(target,'untouched');symlinkSync(target,join(root,'incident.tar.gz'));
  await run();
  const summary=JSON.parse(String(output.mock.calls[0][0]));
  expect(summary).toMatchObject({archive:null,partial:true});
  expect(readFileSync(target,'utf8')).toBe('untouched');
  expect(JSON.parse(readFileSync(join(root,'incident/summary.json'),'utf8'))).toEqual(summary);
 });
 it('reports partial captures in the parent summary', async () => {
  sabotage=dir=>writeFileSync(join(dir,'manifest.json'),JSON.stringify({errorCount:0,partial:true,warnings:['overflow']}));
  await run(['--with-capture']);
  const summary=JSON.parse(String(output.mock.calls[0][0]));
  expect(summary.partial).toBe(true);
  expect(summary.createdPhases).toContainEqual(expect.objectContaining({phase:'capture',ok:false}));
 });
 it('sanitizes captured storage and summaries in both directory and archive', async () => {
  await run(['--with-capture']);
  const summary=JSON.parse(String(output.mock.calls[0][0]));
  expect(summary.warnings).toContainEqual(expect.objectContaining({path:'capture/screenshot.png',reason:'image_unredacted'}));
  const dir=join(root,'incident');
  expect(readFileSync(join(dir,'capture/storage.json'),'utf8')).not.toContain('opaque_fixture_secret');
  expect(readFileSync(join(dir,'logs.ndjson'),'utf8')).not.toContain('fixture-secret');
  const archived=execFileSync('tar',['-xOf',summary.archive,'incident/capture/storage.json'],{encoding:'utf8'});
  expect(archived).toContain('[REDACTED]');expect(archived).not.toContain('opaque_fixture_secret');
  expect(JSON.parse(readFileSync(join(dir,'summary.json'),'utf8'))).toEqual(summary);
  expect(summary.total).toBe(summary.createdPhases.length);
  expect(collected.every(path=>!existsSync(path))).toBe(true);
 });
 it('preserves unrelated files without adding them to the archive', async () => {
  const dir=join(root,'incident');mkdirSync(dir);writeFileSync(join(dir,'private.txt'),'unrelated sensitive text');
  await run();
  expect(readFileSync(join(dir,'private.txt'),'utf8')).toBe('unrelated sensitive text');
  const names=execFileSync('tar',['-tzf',join(root,'incident.tar.gz')],{encoding:'utf8'});
  expect(names).not.toContain('private.txt');
  expect(names).not.toMatch(/(?:^|\/)\._/m);
 });
 it('refuses generated output symlinks without changing their targets', async () => {
  const dir=join(root,'incident');mkdirSync(dir);const other=join(root,'other.json');writeFileSync(other,'unchanged');
  symlinkSync(other,join(dir,'logs.ndjson'));
  await expect(run()).rejects.toThrow('symlink');expect(readFileSync(other,'utf8')).toBe('unchanged');expect(existsSync(join(root,'incident.tar.gz'))).toBe(false);
 });
 it.each(['readonly','symlink','residual'])('does not publish after a %s redaction failure', async kind => {
  sabotage=dir=>{
   if(kind==='readonly') chmodSync(join(dir,'storage.json'),0o400);
   if(kind==='symlink') symlinkSync(join(root,'outside'),join(dir,'unsafe.json'));
   if(kind==='residual') writeFileSync(join(dir,'unrecognized.log'),'Q7wE2rT9yU4iO6pA8sD3fG5hJ0kL1zXcVbNm_+abcdefghijkl');
  };
  await expect(run(['--with-capture'])).rejects.toThrow('Bundle was not published');
  expect(existsSync(join(root,'incident.tar.gz'))).toBe(false);expect(existsSync(join(root,'incident'))).toBe(false);
  expect(exec).not.toHaveBeenCalled();
 });
 it('reports archive failure consistently and still publishes sanitized evidence', async () => {
  vi.mocked(exec).mockRejectedValue(new Error('tar unavailable token=secret-in-error'));
  await run();const summary=JSON.parse(String(output.mock.calls[0][0]));
  expect(summary.archive).toBeNull();expect(summary.partial).toBe(true);
  expect(summary.total).toBe(summary.createdPhases.length);
  expect(JSON.stringify(summary)).not.toContain('secret-in-error');
  expect(JSON.parse(readFileSync(join(root,'incident/summary.json'),'utf8'))).toEqual(summary);
 });
 it('supports directory-only publication', async () => {
  await run(['--no-archive']);expect(exec).not.toHaveBeenCalled();expect(existsSync(join(root,'incident/summary.md'))).toBe(true);
 });
});
