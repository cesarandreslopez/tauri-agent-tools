import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
let magick = 'magick';
try { execFileSync(magick,['-version'],{stdio:'ignore'}); }
catch { magick='convert'; try {execFileSync(magick,['-version'],{stdio:'ignore'});} catch {magick='';} }
let dir: string;
let black: string;
let white: string;
const cli=join(process.cwd(),'dist/cli.js');
function run(a:string,b:string,extra:string[]=[]): {code:number; output:Record<string,unknown>} {
  try {return {code:0,output:JSON.parse(execFileSync(process.execPath,[cli,'diff',a,b,'--json',...extra],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))};}
  catch(error) {return {code:error.status,output:JSON.parse(String(error.stdout || error.stderr))};}
}
describe.skipIf(!magick)('ImageMagick integration', () => {
  beforeAll(() => {
    dir=mkdtempSync(join(tmpdir(),'tauri-images-'));black=join(dir,'black.png');white=join(dir,'white.png');
    execFileSync(magick,['-size','1000x1000','xc:black',black]);execFileSync(magick,['-size','1000x1000','xc:white',white]);
  });
  afterAll(() => rmSync(dir,{recursive:true,force:true}));
  it('reports identical images', () => expect(run(black,black,['--threshold','0'])).toMatchObject({code:0,output:{pixelsDifferent:0,percentDifferent:0}}));
  it('rejects a million different pixels at the 1% threshold', () => expect(run(black,white,['--threshold','1'])).toMatchObject({code:1,output:{pixelsDifferent:1000000,percentDifferent:100}}));
  it('fails when the diff output cannot be written', () => expect(run(black,white,['-o',join(dir,'missing123','out.png')])).toMatchObject({code:1,output:{error:{code:'COMMAND_FAILED'}}}));
  it('fails on a malformed image', () => {
    const malformed=join(dir,'bad.png');writeFileSync(malformed,'not an image');expect(run(black,malformed).code).toBe(1);
  });
});
