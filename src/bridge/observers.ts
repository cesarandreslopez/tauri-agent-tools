import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BridgeClient } from './client.js';

export interface ObserverScripts {
  patch: string;
  drain: string;
  cleanup: string;
}

// Keep observation bounded and serializable without changing app values.
const SERIALIZE = `
  function snapshot(value) {
    var seen = new WeakSet();
    var count = 0;
    var remaining = 32000;
    function visit(item, depth) {
      if (++count > 2000 || depth > 10 || remaining <= 0) return '[Truncated]';
      if (typeof item === 'bigint' || typeof item === 'symbol' || typeof item === 'function') return visit(String(item), depth);
      if (typeof item === 'string') {
        var text = item.slice(0, Math.min(16000, remaining));
        remaining -= text.length;
        return text;
      }
      if (!item || typeof item !== 'object') return item === undefined ? null : item;
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
      if (item instanceof Error) return visit({ name: item.name, message: item.message, stack: item.stack }, depth + 1);
      var result = Array.isArray(item) ? [] : Object.create(null);
      var keys = Object.keys(item);
      for (var i = 0; i < keys.length; i++) {
        if (i >= 200 || count >= 2000 || remaining <= 0) {
          if (Array.isArray(result)) result.push('[Truncated]');
          else result['[Truncated]'] = true;
          break;
        }
        var key = keys[i];
        remaining -= key.length;
        var descriptor = Object.getOwnPropertyDescriptor(item, key);
        // Observing a value must not invoke its getters or custom toJSON.
        result[key.slice(0, 1000)] = descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[Getter]';
      }
      return result;
    }
    try { return visit(value, 0); }
    catch (_) { return '[Unserializable]'; }
  }
  function push(session, entry) {
    if (session.entries.length >= 1000) { session.entries.shift(); session.dropped++; }
    session.entries.push(entry);
  }
`;

function sharedScripts(key: string, id: string, install: string): ObserverScripts {
  const registryKey = JSON.stringify(key);
  const sessionId = JSON.stringify(id);
  return {
    patch: `(() => {
      ${SERIALIZE}
      var registry = window[${registryKey}];
      if (!registry) {
        registry = { sessions: new Map(), restore: function() {} };
        ${install}
        window[${registryKey}] = registry;
      }
      if (registry.sessions.has(${sessionId})) return 'already_patched';
      registry.sessions.set(${sessionId}, { entries: [], dropped: 0 });
      return 'patched';
    })()`,
    drain: `(() => {
      var registry = window[${registryKey}];
      var session = registry && registry.sessions.get(${sessionId});
      if (!session) throw new Error('Observer session ended or the page navigated');
      var batch = { entries: session.entries.splice(0), dropped: session.dropped };
      session.dropped = 0;
      return JSON.stringify(batch);
    })()`,
    cleanup: `(() => {
      var registry = window[${registryKey}];
      if (registry) {
        registry.sessions.delete(${sessionId});
        if (!registry.sessions.size) {
          registry.restore();
          if (window[${registryKey}] === registry) delete window[${registryKey}];
        }
      }
      return 'cleaned';
    })()`,
  };
}

export function consoleObserver(id: string = randomUUID()): ObserverScripts {
  return sharedScripts('__tauriAgentConsole', id, `
    var originals = {}, wrappers = {};
    ['log', 'warn', 'error', 'info', 'debug'].forEach(function(level) {
      var original = console[level];
      originals[level] = original;
      var wrapper = function() {
        var result = original.apply(this, arguments);
        try {
          var message = Array.from(arguments).map(function(arg) {
            return typeof arg === 'object' ? JSON.stringify(snapshot(arg)) : String(arg);
          }).join(' ').slice(0, 16000);
          var entry = { level: level, message: message, timestamp: Date.now() };
          registry.sessions.forEach(function(session) { push(session, entry); });
        } catch (_) { /* Instrumentation must never throw into the app. */ }
        return result;
      };
      wrappers[level] = wrapper;
      console[level] = wrapper;
    });
    registry.restore = function() {
      Object.keys(originals).forEach(function(level) {
        if (console[level] === wrappers[level]) console[level] = originals[level];
      });
    };
  `);
}

export function ipcObserver(id: string = randomUUID()): ObserverScripts {
  return sharedScripts('__tauriAgentIpc', id, `
    var owner = window.__TAURI_INTERNALS__;
    if (!owner || typeof owner.invoke !== 'function') owner = window.__TAURI__ && window.__TAURI__.core;
    if (!owner || typeof owner.invoke !== 'function') return 'no_tauri';
    var original = owner.invoke;
    var wrapper = function(cmd, args, options) {
      // This also keeps the callback captured before cleanup usable afterward.
      if (cmd === '__dev_bridge_result') return original.call(this, cmd, args, options);
      var start = performance.now();
      var recipients = Array.from(registry.sessions.values());
      var entry = { command: cmd, args: snapshot(args || {}), timestamp: Date.now() };
      function record(result, failed) {
        try {
          entry.duration = Math.round(performance.now() - start);
          if (failed) entry.error = result && result.message ? String(result.message) : String(result);
          else entry.result = snapshot(result);
          recipients.forEach(function(session) {
            // A settled call cannot resurrect a collector that already closed.
            if (Array.from(registry.sessions.values()).includes(session)) push(session, entry);
          });
        } catch (_) { /* Keep the original command's outcome. */ }
      }
      var promise;
      try { promise = original.call(this, cmd, args, options); }
      catch (error) { record(error, true); throw error; }
      return promise.then(function(result) { record(result, false); return result; },
        function(error) { record(error, true); throw error; });
    };
    owner.invoke = wrapper;
    registry.restore = function() { if (owner.invoke === wrapper) owner.invoke = original; };
  `);
}

export function mutationObserver(selector: string, attributes: boolean, id: string = randomUUID()): ObserverScripts {
  // An independent observer per selector/session avoids mixing different roots.
  const key = `__tauriAgentMutations_${id}`;
  return sharedScripts(key, id, `
    var target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return 'not_found';
    function describe(el) {
      if (!el || el.nodeType !== 1) return null;
      var value = { tag: el.tagName.toLowerCase() };
      if (el.id) value.id = el.id;
      if (el.classList.length) value.class = Array.from(el.classList).join(' ');
      return value;
    }
    var observer = new MutationObserver(function(records) {
      try {
        records.forEach(function(record) {
          var target = record.target;
          var entry = { type: record.type, timestamp: Date.now(),
            target: target.id ? '#' + target.id : target.tagName ? target.tagName.toLowerCase() : '?' };
          if (record.type === 'childList') {
            entry.added = Array.from(record.addedNodes).map(describe).filter(Boolean);
            entry.removed = Array.from(record.removedNodes).map(describe).filter(Boolean);
          } else if (record.type === 'attributes') {
            entry.attribute = record.attributeName;
            entry.oldValue = record.oldValue;
            entry.newValue = target.getAttribute(record.attributeName);
          }
          registry.sessions.forEach(function(session) { push(session, snapshot(entry)); });
        });
      } catch (_) { /* Keep application mutation delivery unaffected. */ }
    });
    observer.observe(target, { childList: true, subtree: true, attributes: ${attributes}, attributeOldValue: ${attributes} });
    registry.restore = function() { observer.disconnect(); };
  `);
}

const BatchSchema = z.object({ entries: z.array(z.unknown()), dropped: z.number().int().nonnegative() });

export async function readObserver(bridge: Pick<BridgeClient, 'eval'>, scripts: ObserverScripts, warn: (message: string) => void = console.error): Promise<unknown[]> {
  const raw = await bridge.eval(scripts.drain);
  const batch = BatchSchema.parse(JSON.parse(String(raw)));
  if (batch.dropped) warn(`warning: observer dropped ${batch.dropped} buffered entries`);
  return batch.entries;
}

export async function closeObserver(bridge: Pick<BridgeClient, 'eval'>, scripts: ObserverScripts, warn: (message: string) => void = console.error): Promise<void> {
  try {
    const result = await bridge.eval(scripts.cleanup);
    if (result !== 'cleaned') throw new Error(String(result));
  } catch (error) { warn(`warning: observer cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
}
