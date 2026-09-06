import { Command } from 'commander';
import { mutationObserver, readObserver, closeObserver } from '../bridge/observers.js';
import { monitorFor } from '../util/monitor.js';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge, parsePositiveInt } from './shared.js';
import { MutationEntrySchema } from '../schemas/commands.js';
import type { MutationEntry } from '../schemas/commands.js';

export type { MutationEntry };

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

export function registerMutations(program: Command): void {
  const cmd = new Command('mutations')
    .description('Watch DOM mutations on a CSS selector (read-only)')
    .argument('<selector>', 'CSS selector of the element to observe')
    .option('--attributes', 'Also watch attribute changes')
    .option('--interval <ms>', 'Poll interval in milliseconds', parsePositiveInt, 500)
    .option('--duration <ms>', 'Auto-stop after N milliseconds', parsePositiveInt)
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
    const scripts = mutationObserver(selector, !!opts.attributes);
    try {
      const patchResult = await bridge.eval(scripts.patch);
      if (patchResult === 'not_found') throw new Error(`Element not found: ${selector}`);
      if (patchResult !== 'patched' && patchResult !== 'already_patched') throw new Error(`Observer setup failed: ${String(patchResult)}`);

      if (!opts.json) {
        console.error(`Watching mutations on ${selector}... (Ctrl+C to stop)`);
      }

      await monitorFor(opts, async () => {
        const entries = z.array(MutationEntrySchema).parse(await readObserver(bridge, scripts));

        for (const entry of entries) {
          if (opts.json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatEntry(entry));
          }
        }
      });
    } finally {
      await closeObserver(bridge, scripts);
    }
  });

  program.addCommand(cmd);
}
