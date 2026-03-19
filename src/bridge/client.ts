import type { BridgeConfig } from '../schemas/bridge.js';
import {
  ElementRectSchema,
  ViewportSizeSchema,
  BridgeEvalResponseSchema,
  BridgeLogsResponseSchema,
} from '../schemas/bridge.js';
import type { ElementRect, RustLogEntry } from '../schemas/bridge.js';
import { A11yNodeSchema } from '../schemas/dom.js';
import type { A11yNode } from '../schemas/dom.js';

export class BridgeClient {
  private baseUrl: string;
  private token: string;

  constructor(config: BridgeConfig) {
    this.baseUrl = `http://127.0.0.1:${config.port}`;
    this.token = config.token;
  }

  async eval(js: string, timeout = 5000): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ js, token: this.token }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error('Bridge authentication failed — check your token');
      }
      throw new Error(`Bridge error (${res.status}): ${text}`);
    }

    const data = BridgeEvalResponseSchema.parse(await res.json());
    return data.result;
  }

  async getElementRect(selector: string): Promise<ElementRect | null> {
    const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const js = `(() => {
      const el = document.querySelector('${escaped}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
    })()`;

    const result = await this.eval(js);
    if (result === null || result === undefined) return null;
    return ElementRectSchema.parse(JSON.parse(String(result)));
  }

  async getViewportSize(): Promise<{ width: number; height: number }> {
    const js = `JSON.stringify({ width: window.innerWidth, height: window.innerHeight })`;
    const result = await this.eval(js);
    return ViewportSizeSchema.parse(JSON.parse(String(result)));
  }

  async getDocumentTitle(): Promise<string> {
    const result = await this.eval('document.title');
    return String(result ?? '');
  }

  async getAccessibilityTree(selector = 'body', depth = 10): Promise<A11yNode | null> {
    const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const js = `(() => {
      function getRole(el) {
        return el.computedRole || el.getAttribute('role') || el.tagName.toLowerCase();
      }
      function getLabel(el) {
        if (el.computedLabel) return el.computedLabel;
        var label = el.getAttribute('aria-label');
        if (label) return label;
        var labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          var ref = document.getElementById(labelledBy);
          if (ref) return ref.textContent.trim();
        }
        if (['button','a','label','th','td','caption','legend','figcaption'].indexOf(el.tagName.toLowerCase()) !== -1) {
          var t = el.textContent.trim();
          if (t.length <= 80) return t;
          return t.slice(0, 77) + '...';
        }
        var alt = el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder');
        if (alt) return alt;
        return '';
      }
      function getState(el) {
        var s = {};
        if (el.disabled) s.disabled = true;
        if (el.checked) s.checked = true;
        if (el.getAttribute('aria-expanded')) s.expanded = el.getAttribute('aria-expanded') === 'true';
        if (el.getAttribute('aria-selected')) s.selected = el.getAttribute('aria-selected') === 'true';
        if (el.required) s.required = true;
        if (el.getAttribute('aria-current')) s.current = el.getAttribute('aria-current');
        if (el.getAttribute('aria-level')) s.level = parseInt(el.getAttribute('aria-level'));
        if (el.tagName.match(/^H[1-6]$/)) s.level = parseInt(el.tagName[1]);
        return Object.keys(s).length ? s : undefined;
      }
      function walk(el, d, maxD) {
        var role = getRole(el);
        var label = getLabel(el);
        var state = getState(el);
        var node = { role: role };
        if (label) node.name = label;
        if (state) node.state = state;
        if (d < maxD) {
          var kids = [];
          for (var i = 0; i < el.children.length; i++) {
            var child = walk(el.children[i], d + 1, maxD);
            if (child) kids.push(child);
          }
          if (kids.length) node.children = kids;
        }
        return node;
      }
      var root = document.querySelector('${escaped}');
      if (!root) return null;
      return JSON.stringify(walk(root, 0, ${depth}));
    })()`;

    const result = await this.eval(js);
    if (result === null || result === undefined) return null;
    return A11yNodeSchema.parse(JSON.parse(String(result)));
  }

  async fetchLogs(timeout = 5000): Promise<RustLogEntry[]> {
    const res = await fetch(`${this.baseUrl}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          'Bridge does not support /logs — update your dev_bridge.rs to the latest version',
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('Bridge authentication failed — check your token');
      }
      const text = await res.text().catch(() => '');
      throw new Error(`Bridge error (${res.status}): ${text}`);
    }

    const data = BridgeLogsResponseSchema.parse(await res.json());
    return data.entries;
  }

  async ping(): Promise<boolean> {
    try {
      await this.eval('1', 2000);
      return true;
    } catch {
      return false;
    }
  }
}
