import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerWait } from '../../src/commands/wait.js';
import { registerEval } from '../../src/commands/eval.js';
import { registerCheck } from '../../src/commands/check.js';
import { registerClick } from '../../src/commands/interact/click.js';
import { evaluateExpression } from '../../src/bridge/evaluate.js';
import { webview } from '../helpers/webview.js';

let fixture: ReturnType<typeof webview>;
const initialExitCode = process.exitCode;
afterEach(() => { fixture?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = initialExitCode; });

function setup() {
  fixture = webview();
  const fetch = vi.fn(async (_url, options) => new Response(JSON.stringify({
    result: await fixture.bridge.eval(JSON.parse(options.body).js),
  }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const program = new Command().exitOverride();
  registerWait(program, () => { throw new Error('Should not need platform tools'); });
  registerEval(program); registerCheck(program); registerClick(program);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const run = (args: string[]) => program.parseAsync(['node', 'fixture', ...args, '--port', '9999', '--token', 'fixture']);
  return { run, fetch, output };
}

describe('automation through the shipped bridge callback', () => {
  it.each(['value', 'kind', 'encoded'])('evaluates the app global %s without shadowing it', async name => {
    const { run, output } = setup();
    fixture.window[name] = `app ${name}`;
    await run(['eval', name, '--json']);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({ result: `app ${name}` });
  });
  it('waits successfully for an existing selector', async () => {
    const {run, output} = setup();
    await run(['wait', '--selector', '#existing', '--timeout', '100', '--json']);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({matched:true, mode:'selector'});
  });
  it.each(['false', '0', 'null', 'undefined', '""', 'NaN', '0n', 'Promise.resolve(false)'])('does not mistake %s for truth', async expression => {
    const {run} = setup();
    await expect(run(['wait', '--eval', expression, '--timeout', '30', '--interval', '5'])).rejects.toThrow(/Timed out/);
  });
  it.each(['"false"', '"0"', '[]', '{}', '1n', 'Infinity', '() => true', 'Promise.resolve(true)'])('accepts actual JS truthiness of %s', async expression => {
    setup();
    expect((await evaluateExpression(fixture.bridge, `(${expression})`)).truthy).toBe(true);
  });
  it('keeps literal ERROR strings separate from thrown errors', async () => {
    const {run, output} = setup();
    await run(['eval', '"ERROR: just text"', '--json']);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({result:'ERROR: just text'});
    await expect(evaluateExpression(fixture.bridge, 'throw new Error("fixture failure")')).rejects.toThrow('fixture failure');
  });
  it('round-trips escaped selectors without altering the CSS', async () => {
    const {run} = setup();
    fixture.window.document.body.innerHTML = '<div id="a:b">found</div>';
    await run(['wait', '--selector', '#a\\:b', '--timeout', '100']);
  });
  it('rejects invalid options and empty assertions before contacting the app', async () => {
    for (const args of [ ['check','--json'], ['wait','--eval','true','--timeout','10junk'],
      ['wait','--eval','true','--interval','0'], ['wait','--eval','true','--selector','#existing'] ]) {
      const {run,fetch} = setup();
      await expect(run(args)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      fixture.close();
    }
  });
  it('checks awaited expressions and surfaces their exceptions', async () => {
    const {run,output} = setup();
    await run(['check','--eval','Promise.resolve(false)','--json']);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({passed:false});
    expect(process.exitCode).toBe(1);
  });
  it('polls for click readiness in the CLI before dispatching exactly one click', async () => {
    const {run,fetch} = setup();
    let clicked = 0;
    fixture.window.setTimeout(() => {
      const button = fixture.window.document.createElement('button'); button.id = 'late';
      button.onclick = () => clicked++;
      fixture.window.document.body.append(button);
    }, 15);
    await run(['click','#late','--wait','6000']);
    expect(clicked).toBe(1);
    const scripts = fetch.mock.calls.map(([,options]) => JSON.parse(options.body).js);
    expect(scripts.filter(js => js.includes('dispatchEvent'))).toHaveLength(1);
    expect(scripts.some(js => js.includes('deadline'))).toBe(false);
  });
});
