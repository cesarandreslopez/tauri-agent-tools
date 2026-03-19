import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeClient } from '../bridge/client.js';
import { MutationEntrySchema } from '../schemas.js';
import type { MutationEntry } from '../schemas.js';

export type { MutationEntry };

function buildPatchScript(selector: string, watchAttributes: boolean): string {
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `(() => {
  if (window.__tauriDevToolsMutationPatched) return 'already_patched';
  var target = document.querySelector('${escaped}');
  if (!target) return 'not_found';
  window.__tauriDevToolsMutationLog = [];
  function describeEl(el) {
    if (!el || el.nodeType !== 1) return null;
    var d = { tag: el.tagName.toLowerCase() };
    if (el.id) d.id = el.id;
    var cls = Array.from(el.classList).join(' ');
    if (cls) d.class = cls;
    return d;
  }
  window.__tauriDevToolsMutationObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var entry = { type: m.type, timestamp: Date.now() };
      var t = m.target;
      entry.target = (t.id ? '#' + t.id : '') || (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ').join('.') : t.tagName ? t.tagName.toLowerCase() : '?');
      if (m.type === 'childList') {
        entry.added = Array.from(m.addedNodes).map(describeEl).filter(Boolean);
        entry.removed = Array.from(m.removedNodes).map(describeEl).filter(Boolean);
      } else if (m.type === 'attributes') {
        entry.attribute = m.attributeName;
        entry.oldValue = m.oldValue;
        entry.newValue = m.target.getAttribute(m.attributeName);
      }
      window.__tauriDevToolsMutationLog.push(entry);
    }
  });
  window.__tauriDevToolsMutationObserver.observe(target, {
    childList: true,
    subtree: true,
    attributes: ${watchAttributes},
    attributeOldValue: ${watchAttributes}
  });
  window.__tauriDevToolsMutationPatched = true;
  return 'patched';
})()`;
}

const DRAIN_SCRIPT = `(() => {
  var log = window.__tauriDevToolsMutationLog || [];
  window.__tauriDevToolsMutationLog = [];
  return JSON.stringify(log);
})()`;

const CLEANUP_SCRIPT = `(() => {
  if (window.__tauriDevToolsMutationObserver) {
    window.__tauriDevToolsMutationObserver.disconnect();
    delete window.__tauriDevToolsMutationObserver;
    delete window.__tauriDevToolsMutationLog;
    delete window.__tauriDevToolsMutationPatched;
  }
  return 'cleaned';
})()`;

export function formatEntry(entry: MutationEntry): string {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  if (entry.type === 'childList') {
    const parts: string[] = [];
    if (entry.added?.length) {
      parts.push(`+${entry.added.map(n => n.class ? `.${n.class.split(' ').join('.')}` : n.tag).join(', ')}`);
    }
    if (entry.removed?.length) {
      parts.push(`-${entry.removed.map(n => n.class ? `.${n.class.split(' ').join('.')}` : n.tag).join(', ')}`);
    }
    return `[${time}] childList ${entry.target} ${parts.join(' ')}`;
  }
  if (entry.type === 'attributes') {
    return `[${time}] attr ${entry.target} ${entry.attribute}: ${entry.oldValue} → ${entry.newValue}`;
  }
  return `[${time}] ${entry.type} ${entry.target}`;
}

async function cleanup(bridge: BridgeClient): Promise<void> {
  try {
    await bridge.eval(CLEANUP_SCRIPT);
  } catch {
    // Best-effort cleanup
  }
}

export function registerMutations(program: Command): void {
  const cmd = new Command('mutations')
    .description('Watch DOM mutations on a CSS selector (read-only)')
    .argument('<selector>', 'CSS selector of the element to observe')
    .option('--attributes', 'Also watch attribute changes')
    .option('--interval <ms>', 'Poll interval in milliseconds', parseInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parseInt)
    .option('--json', 'Output one JSON object per line');

  addBridgeOptions(cmd);

  cmd.action(async (selector: string, opts: {
    attributes?: boolean;
    interval: number;
    duration?: number;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const bridge = await resolveBridge(opts);

    const patchResult = await bridge.eval(buildPatchScript(selector, !!opts.attributes));
    if (patchResult === 'not_found') {
      throw new Error(`Element not found: ${selector}`);
    }
    if (patchResult === 'already_patched') {
      console.error('Warning: mutation observer already active — draining existing log');
    }

    let stopped = false;

    const onSignal = () => {
      stopped = true;
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.duration) {
      timer = setTimeout(() => {
        stopped = true;
      }, opts.duration);
    }

    if (!opts.json) {
      console.error(`Watching mutations on ${selector}... (Ctrl+C to stop)`);
    }

    try {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, opts.interval));
        if (stopped) break;

        const raw = await bridge.eval(DRAIN_SCRIPT);
        const entries = z.array(MutationEntrySchema).parse(JSON.parse(String(raw)));

        for (const entry of entries) {
          if (opts.json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatEntry(entry));
          }
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await cleanup(bridge);
    }
  });

  program.addCommand(cmd);
}
