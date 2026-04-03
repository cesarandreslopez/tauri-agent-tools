import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { ScrollResultSchema } from '../../schemas/interact.js';

export interface ScrollOpts {
  selector?: string;
  by?: number;
  to?: number;
  toTop?: boolean;
  toBottom?: boolean;
  intoView?: boolean;
}

export function buildScrollScript(opts: ScrollOpts): string {
  const { selector, by, to, toTop, toBottom, intoView } = opts;

  if (selector && intoView) {
    const escaped = escapeSelector(selector);
    return `(function() {
  try {
    var el = document.querySelector('${escaped}');
    if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return JSON.stringify({ success: true, scrollX: window.scrollX, scrollY: window.scrollY });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
  }

  if (selector) {
    const escaped = escapeSelector(selector);
    let scrollCall: string;
    if (toTop) {
      scrollCall = `el.scrollTo(0, 0)`;
    } else if (toBottom) {
      scrollCall = `el.scrollTo(0, el.scrollHeight)`;
    } else if (to !== undefined) {
      scrollCall = `el.scrollTo(0, ${to})`;
    } else if (by !== undefined) {
      scrollCall = `el.scrollBy(0, ${by})`;
    } else {
      scrollCall = `el.scrollBy(0, 0)`;
    }
    return `(function() {
  try {
    var el = document.querySelector('${escaped}');
    if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
    ${scrollCall};
    return JSON.stringify({ success: true, scrollX: el.scrollLeft, scrollY: el.scrollTop });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
  }

  // No selector — scroll on window
  let scrollCall: string;
  if (toTop) {
    scrollCall = `window.scrollTo(0, 0)`;
  } else if (toBottom) {
    scrollCall = `window.scrollTo(0, document.documentElement.scrollHeight)`;
  } else if (to !== undefined) {
    scrollCall = `window.scrollTo(0, ${to})`;
  } else if (by !== undefined) {
    scrollCall = `window.scrollBy(0, ${by})`;
  } else {
    scrollCall = `window.scrollBy(0, 0)`;
  }

  return `(function() {
  try {
    ${scrollCall};
    return JSON.stringify({ success: true, scrollX: window.scrollX, scrollY: window.scrollY });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})()`;
}

export function registerScroll(program: Command): void {
  const cmd = new Command('scroll')
    .description('Scroll the page or a specific element')
    .option('-s, --selector <css>', 'CSS selector of the element to scroll')
    .option('--by <px>', 'Scroll by N pixels (vertical)', parseInt)
    .option('--to <px>', 'Scroll to absolute pixel position (vertical)', parseInt)
    .option('--to-top', 'Scroll to top')
    .option('--to-bottom', 'Scroll to bottom')
    .option('--into-view', 'Scroll element into view (requires --selector)')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools scroll --by 200
  $ tauri-agent-tools scroll --to-bottom
  $ tauri-agent-tools scroll --selector ".content" --into-view
  $ tauri-agent-tools scroll --selector ".panel" --by 100`);

  addInteractOptions(cmd);

  cmd.action(async (opts: BridgeOpts & {
    selector?: string;
    by?: number;
    to?: number;
    toTop?: boolean;
    toBottom?: boolean;
    intoView?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);
    const script = buildScrollScript({
      selector: opts.selector,
      by: opts.by,
      to: opts.to,
      toTop: opts.toTop,
      toBottom: opts.toBottom,
      intoView: opts.intoView,
    });
    const raw = await bridge.eval(script);
    const result = ScrollResultSchema.parse(JSON.parse(String(raw)));
    if (!result.success) {
      throw new Error(result.error ?? 'Scroll failed');
    }
    console.log(JSON.stringify(result, null, 2));
  });

  program.addCommand(cmd);
}
