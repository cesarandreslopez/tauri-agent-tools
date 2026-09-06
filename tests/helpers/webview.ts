import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Exercise the actual callback shipped to integrators, including its historical
// string coercion and capturing invoke before evaluating the supplied script.
const rust = readFileSync(new URL('../../examples/tauri-bridge/src/dev_bridge.rs', import.meta.url), 'utf8');
const template = rust.match(/fn build_eval_callback_js[\s\S]*?r#"([\s\S]*?)"#,/)!;

export function webview(html = '<div id="existing">Ready</div>', invoke = async (..._args: unknown[]) => 'ok') {
  const dom = new JSDOM(html, { url: 'http://localhost:1420', runScripts: 'outside-only' });
  const { window } = dom;
  const replies = new Map<string, unknown>();
  let sequence = 0;
  const original = async (command: string, args: { id: string; value: unknown }, options?: unknown) => {
    if (command === '__dev_bridge_result') { replies.set(args.id, args.value); return null; }
    return invoke(command, args, options);
  };
  window.__TAURI_INTERNALS__ = { invoke: original };
  const bridge = {
    async eval(js: string, _timeout?: number): Promise<unknown> {
      const id = `fixture-${sequence++}`;
      const script = template[1].replace(/\{\{/g, '{').replace(/\}\}/g, '}')
        .replace('{js}', () => JSON.stringify(js)).replaceAll('{id}', JSON.stringify(id));
      await window.eval(script);
      if (!replies.has(id)) throw new Error('No bridge result callback');
      const value = replies.get(id);
      replies.delete(id);
      return value;
    },
  };
  return { window, bridge, original, close: () => window.close() };
}
