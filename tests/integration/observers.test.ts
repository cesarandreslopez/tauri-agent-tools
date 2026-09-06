import { afterEach, describe, expect, it, vi } from 'vitest';
import { webview } from '../helpers/webview.js';
import { ipcObserver, consoleObserver, mutationObserver, readObserver, closeObserver } from '../../src/bridge/observers.js';
import { monitorFor } from '../../src/util/monitor.js';

let fixture: ReturnType<typeof webview>;
afterEach(() => { fixture?.close(); vi.restoreAllMocks(); });

describe('observation through the shipped callback', () => {
  it('bounds large IPC values and avoids executing getters while observing them', async () => {
    fixture = webview();
    const scripts = ipcObserver(); await fixture.bridge.eval(scripts.patch);
    const getter = vi.fn(() => { throw new Error('must not run'); });
    const payload = { large: new Array(5000).fill('x'.repeat(10000)) };
    Object.defineProperty(payload, 'lazy', { get: getter, enumerable: true });
    await fixture.window.__TAURI_INTERNALS__.invoke('large', payload);
    const entries = await readObserver(fixture.bridge, scripts);
    expect(JSON.stringify(entries).length).toBeLessThan(40000);
    expect(getter).not.toHaveBeenCalled();
    expect(payload.large).toHaveLength(5000);
    await closeObserver(fixture.bridge, scripts);
  });
  it('does not record internal replies or grow idle IPC payloads, and cleans up', async () => {
    fixture = webview();
    const scripts = ipcObserver();
    await fixture.bridge.eval(scripts.patch);
    for (let i=0;i<20;i++) expect(await readObserver(fixture.bridge, scripts)).toEqual([]);
    await closeObserver(fixture.bridge, scripts);
    expect(fixture.window.__TAURI_INTERNALS__.invoke).toBe(fixture.original);
  });
  it('delivers events independently to overlapping subscribers', async () => {
    fixture = webview();
    const a = ipcObserver(), b = ipcObserver();
    await fixture.bridge.eval(a.patch); await fixture.bridge.eval(b.patch);
    await fixture.window.__TAURI_INTERNALS__.invoke('get_data', {id:1});
    expect(await readObserver(fixture.bridge,a)).toHaveLength(1);
    expect(await readObserver(fixture.bridge,b)).toHaveLength(1);
    await closeObserver(fixture.bridge,a);
    await fixture.window.__TAURI_INTERNALS__.invoke('next', {});
    expect(await readObserver(fixture.bridge,b)).toMatchObject([{command:'next'}]);
    await closeObserver(fixture.bridge,b);
  });
  it('preserves the outcome of IPC calls that finish after cleanup', async () => {
    let finish!: (value: string) => void;
    fixture = webview('', () => new Promise(resolve => { finish=resolve; }));
    const scripts = ipcObserver();
    await fixture.bridge.eval(scripts.patch);
    const pending = fixture.window.__TAURI_INTERNALS__.invoke('slow', {});
    await closeObserver(fixture.bridge,scripts);
    finish('success');
    await expect(pending).resolves.toBe('success');
  });
  it('preserves original exceptions while observing a rejected IPC', async () => {
    const originalError = new Error('application rejected');
    fixture = webview('', async () => { throw originalError; });
    const scripts=ipcObserver(); await fixture.bridge.eval(scripts.patch);
    await expect(fixture.window.__TAURI_INTERNALS__.invoke('reject',{})).rejects.toBe(originalError);
    expect(await readObserver(fixture.bridge,scripts)).toMatchObject([{command:'reject',error:'application rejected'}]);
    await closeObserver(fixture.bridge,scripts);
  });
  it('logs circular values and bigints without disrupting console or other collectors', async () => {
    fixture=webview(); const original=vi.fn(); fixture.window.console.error=original;
    const a=consoleObserver(), b=consoleObserver();
    await fixture.bridge.eval(a.patch); await fixture.bridge.eval(b.patch);
    const cyclic: Record<string,unknown>={}; cyclic.self=cyclic;
    expect(() => fixture.window.console.error(cyclic, 10n)).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
    expect(await readObserver(fixture.bridge,a)).toMatchObject([{level:'error',message:expect.stringContaining('[Circular]')}]);
    await closeObserver(fixture.bridge,a);
    expect(await readObserver(fixture.bridge,b)).toHaveLength(1);
    await closeObserver(fixture.bridge,b);
    expect(fixture.window.console.error).toBe(original);
  });
  it('bounds buffers and reports lost entries', async () => {
    fixture=webview(); fixture.window.console.log=()=>{};
    const scripts=consoleObserver(); await fixture.bridge.eval(scripts.patch);
    for(let i=0;i<1005;i++) fixture.window.console.log(i);
    const warn=vi.spyOn(console,'error').mockImplementation(()=>{});
    expect(await readObserver(fixture.bridge,scripts)).toHaveLength(1000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 5'));
    await closeObserver(fixture.bridge,scripts);
  });
  it('keeps mutation selectors isolated', async () => {
    fixture=webview('<div id="a"></div><div id="b"></div>');
    const a=mutationObserver('#a',false),b=mutationObserver('#b',false);
    await fixture.bridge.eval(a.patch);await fixture.bridge.eval(b.patch);
    fixture.window.document.querySelector('#a')!.textContent='changed';
    await Promise.resolve();
    expect(await readObserver(fixture.bridge,a)).toHaveLength(1);
    expect(await readObserver(fixture.bridge,b)).toEqual([]);
    await closeObserver(fixture.bridge,a);await closeObserver(fixture.bridge,b);
  });
  it('takes a final sample even when duration is less than interval', async () => {
    const sample=vi.fn().mockResolvedValue(undefined);
    await monitorFor({duration:10,interval:1000},sample);
    expect(sample).toHaveBeenCalledTimes(1);
  });
});
