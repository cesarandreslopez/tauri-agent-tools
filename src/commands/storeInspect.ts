import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { StoreInspectResultSchema } from '../schemas/commands.js';
import type { StoreInspectResult } from '../schemas/commands.js';

/**
 * Builds a JavaScript IIFE that detects and serializes reactive stores
 * from the target framework running in the Tauri webview.
 *
 * Detection priority:
 * 1. window.__DEBUG_STORES__ (app-registered hook)
 * 2. window.__pinia (Pinia store)
 * 3. window.__VUE_DEVTOOLS_GLOBAL_HOOK__ (Vue devtools hook)
 * 4. Fallback: unknown with empty stores
 */
export function buildStoreDetectionScript(
  framework: string,
  storeName?: string,
  depth: number = 3,
): string {
  const storeNameFilter = storeName ? JSON.stringify(storeName) : 'null';

  return `(function() {
  var maxDepth = ${depth};
  var storeNameFilter = ${storeNameFilter};

  function serialize(obj, maxD, currentD) {
    if (currentD === undefined) currentD = 0;
    try {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
      if (currentD >= maxD) return '[max depth]';
      if (Array.isArray(obj)) {
        var arr = obj.slice(0, 100).map(function(item) { return serialize(item, maxD, currentD + 1); });
        if (obj.length > 100) arr.push('[truncated, ' + (obj.length - 100) + ' more]');
        return arr;
      }
      if (typeof obj === 'object') {
        var keys = Object.keys(obj).slice(0, 50);
        var result = {};
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          try { result[k] = serialize(obj[k], maxD, currentD + 1); } catch(e) { result[k] = '[error]'; }
        }
        if (Object.keys(obj).length > 50) result['__truncated__'] = true;
        return result;
      }
      return String(obj);
    } catch(e) {
      return '[error]';
    }
  }

  // Check for app-registered debug hook first
  if (typeof window.__DEBUG_STORES__ === 'function') {
    try {
      var hookResult = window.__DEBUG_STORES__();
      var hookStores = {};
      if (hookResult && typeof hookResult === 'object') {
        var hookKeys = Object.keys(hookResult);
        for (var i = 0; i < hookKeys.length; i++) {
          var key = hookKeys[i];
          if (storeNameFilter === null || key === storeNameFilter) {
            hookStores[key] = serialize(hookResult[key], maxDepth, 0);
          }
        }
      }
      return JSON.stringify({ framework: 'custom', stores: hookStores });
    } catch(e) {
      // fall through to framework detection
    }
  }

  var stores = {};
  var detectedFramework = 'unknown';

  // Pinia detection
  if ((${framework === 'auto' || framework === 'pinia' ? 'true' : 'false'}) && window.__pinia) {
    try {
      var pinia = window.__pinia;
      if (pinia._s && typeof pinia._s.forEach === 'function') {
        pinia._s.forEach(function(store, id) {
          if (storeNameFilter === null || id === storeNameFilter) {
            try {
              var state = store.$state;
              stores[id] = serialize(state, maxDepth, 0);
            } catch(e) {
              stores[id] = '[error]';
            }
          }
        });
        detectedFramework = 'pinia';
      }
    } catch(e) {
      // continue to next detection
    }
  }

  // Vue devtools hook detection
  if ((${framework === 'auto' || framework === 'vue' ? 'true' : 'false'}) && detectedFramework === 'unknown' && window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    try {
      var hook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
      if (hook.store) {
        var vueStoreId = storeNameFilter || 'vuex';
        if (storeNameFilter === null || storeNameFilter === 'vuex') {
          stores[vueStoreId] = serialize(hook.store.state, maxDepth, 0);
        }
        detectedFramework = 'vue';
      } else if (hook.stores && typeof hook.stores.forEach === 'function') {
        hook.stores.forEach(function(store) {
          var sid = (store.$id || store.id || 'store');
          if (storeNameFilter === null || sid === storeNameFilter) {
            stores[sid] = serialize(store.$state || store.state, maxDepth, 0);
          }
        });
        detectedFramework = 'vue';
      }
    } catch(e) {
      // continue to fallback
    }
  }

  return JSON.stringify({ framework: detectedFramework, stores: stores });
})()`;
}

function formatStoreInspectResult(result: StoreInspectResult): string {
  const storeKeys = Object.keys(result.stores);
  const lines: string[] = [`Framework: ${result.framework}`];

  if (storeKeys.length === 0) {
    lines.push('Stores: (none detected)');
  } else {
    lines.push(`Stores (${storeKeys.length}):`);
    for (const key of storeKeys) {
      lines.push(`  ${key}:`);
      lines.push(`    ${JSON.stringify(result.stores[key], null, 2).replace(/\n/g, '\n    ')}`);
    }
  }
  return lines.join('\n');
}

export function registerStoreInspect(program: Command): void {
  const cmd = new Command('store-inspect')
    .description('Inspect reactive stores (Pinia, Vue, or custom app-registered hook)')
    .option('--framework <name>', 'Framework to inspect: auto, pinia, vue', 'auto')
    .option('--store <name>', 'Filter to a specific store by name')
    .option('--depth <n>', 'Serialization depth', parseInt, 3)
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(
    async (opts: BridgeOpts & {
      framework: string;
      store?: string;
      depth: number;
      json?: boolean;
    }) => {
      const bridge = await resolveBridge(opts);
      const script = buildStoreDetectionScript(opts.framework, opts.store, opts.depth);
      const raw = await bridge.eval(script);
      const result = StoreInspectResultSchema.parse(JSON.parse(String(raw)));

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatStoreInspectResult(result));
      }
    },
  );

  program.addCommand(cmd);
}
