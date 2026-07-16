import type { BridgeConfig } from '../schemas/bridge.js';
import {
  ElementRectSchema,
  ViewportSizeSchema,
  BridgeEvalResponseSchema,
  BridgeLogsResponseSchema,
  DescribeResponseSchema,
  VersionResponseSchema,
  ProcessResponseSchema,
  CapabilitiesResponseSchema,
  DevtoolsResponseSchema,
  HealthResponseSchema,
} from '../schemas/bridge.js';
import type {
  ElementRect,
  RustLogEntry,
  DescribeResponse,
  VersionResponse,
  ProcessResponse,
  CapabilitiesResponse,
  DevtoolsResponse,
  HealthResponse,
} from '../schemas/bridge.js';
import { A11yNodeSchema } from '../schemas/dom.js';
import type { A11yNode } from '../schemas/dom.js';

/**
 * Minimum bridge version supplying a given endpoint. Used by `requireEndpoint`
 * to translate a missing-endpoint condition into an actionable error instead
 * of an opaque 404.
 */
const ENDPOINT_MIN_VERSION: Record<string, string> = {
  '/process': '0.7.0',
  '/capabilities': '0.7.0',
  '/devtools': '0.7.0',
  '/health': '0.7.0',
};
// The v0.8 cursor capability lives on /logs, a base endpoint served by every
// bridge version, so it has no entry above. Clients feature-detect it by
// response shape instead: a cursor-mode request answered by an older bridge
// comes back without a `cursor` field (see fetchLogs).

interface FetchLogsOptions {
  cursor?: number;
  waitMs?: number;
  limit?: number;
  timeoutMs?: number;
}

interface FetchLogsCursorResponse {
  entries: RustLogEntry[];
  cursor?: number;
  dropped?: number;
}

export class BridgeClient {
  private baseUrl: string;
  private token: string;
  private windowLabel: string | undefined;
  /** Cached `/version` response. Populated by `requireEndpoint` on first call. */
  private versionCache: VersionResponse | null = null;
  /** Set when `/version` is unreachable so we don't retry it for every call. */
  private versionUnreachable = false;

  constructor(config: BridgeConfig, windowLabel?: string) {
    this.baseUrl = `http://127.0.0.1:${config.port}`;
    this.token = config.token;
    this.windowLabel = windowLabel;
  }

  async eval(js: string, timeout = 5000): Promise<unknown> {
    const body: Record<string, unknown> = { js, token: this.token };
    if (this.windowLabel !== undefined) {
      body.window = this.windowLabel;
    }

    const res = await fetch(`${this.baseUrl}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  async fetchLogs(timeout?: number): Promise<RustLogEntry[]>;
  async fetchLogs(opts: FetchLogsOptions): Promise<FetchLogsCursorResponse>;
  async fetchLogs(
    arg: number | FetchLogsOptions = 5000,
  ): Promise<RustLogEntry[] | FetchLogsCursorResponse> {
    const opts = typeof arg === 'number' ? undefined : arg;
    const timeout = typeof arg === 'number' ? arg : arg.timeoutMs ?? 5000;
    const body: Record<string, unknown> = { token: this.token };
    if (opts?.cursor !== undefined) body.cursor = opts.cursor;
    if (opts?.waitMs !== undefined) body.waitMs = opts.waitMs;
    if (opts?.limit !== undefined) body.limit = opts.limit;

    const res = await fetch(`${this.baseUrl}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    if (opts !== undefined) {
      return {
        entries: data.entries,
        cursor: data.cursor,
        dropped: data.dropped,
      };
    }
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

  async describe(): Promise<DescribeResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return DescribeResponseSchema.parse(await res.json());
    } catch {
      return null;
    }
  }

  async version(): Promise<VersionResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/version`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return VersionResponseSchema.parse(await res.json());
    } catch {
      return null;
    }
  }

  /**
   * Verify the bridge exposes the requested endpoint. Caches the `/version`
   * response so a CLI command that hits the bridge multiple times only pays
   * one roundtrip for feature detection. Throws an actionable error when the
   * bridge is too old, with a hint pointing integrators at the example.
   */
  async requireEndpoint(path: string): Promise<void> {
    if (this.versionUnreachable) {
      throw new Error(
        `Bridge at ${this.baseUrl} did not respond to /version. The bridge may be ` +
          `too old (pre-0.6.0) or not running. Confirm the dev server is up and try again.`,
      );
    }
    if (this.versionCache === null) {
      const v = await this.version();
      if (v === null) {
        this.versionUnreachable = true;
        throw new Error(
          `Bridge at ${this.baseUrl} did not respond to /version. The bridge may be ` +
            `too old (pre-0.6.0) or not running. Confirm the dev server is up and try again.`,
        );
      }
      this.versionCache = v;
    }
    if (this.versionCache.endpoints.includes(path)) return;

    const minVersion = ENDPOINT_MIN_VERSION[path];
    const versionHint = minVersion
      ? `requires bridge v${minVersion}+ (this app reports v${this.versionCache.version})`
      : `is not supported by the running bridge (v${this.versionCache.version})`;
    throw new Error(
      `${path} ${versionHint}. ` +
        `Re-copy examples/tauri-bridge/src/dev_bridge.rs into your app and rebuild — ` +
        `see rust-bridge/README.md.`,
    );
  }

  /**
   * Non-throwing capability check: resolves true iff the running bridge
   * advertises `path` in its `/version` endpoint list. Shares the `/version`
   * cache with {@link requireEndpoint}, so repeated checks cost one roundtrip.
   * Resolves false when the bridge is unreachable or too old to report
   * `/version` — letting callers degrade gracefully instead of throwing.
   */
  async hasEndpoint(path: string): Promise<boolean> {
    if (this.versionUnreachable) return false;
    if (this.versionCache === null) {
      const v = await this.version();
      if (v === null) {
        this.versionUnreachable = true;
        return false;
      }
      this.versionCache = v;
    }
    return this.versionCache.endpoints.includes(path);
  }

  async process(): Promise<ProcessResponse> {
    await this.requireEndpoint('/process');
    const res = await this.postAuthed('/process');
    return ProcessResponseSchema.parse(await res.json());
  }

  async capabilities(): Promise<CapabilitiesResponse> {
    await this.requireEndpoint('/capabilities');
    const res = await this.postAuthed('/capabilities');
    return CapabilitiesResponseSchema.parse(await res.json());
  }

  async devtools(): Promise<DevtoolsResponse> {
    await this.requireEndpoint('/devtools');
    const res = await this.postAuthed('/devtools');
    return DevtoolsResponseSchema.parse(await res.json());
  }

  async health(): Promise<HealthResponse> {
    await this.requireEndpoint('/health');
    const res = await this.postAuthed('/health');
    return HealthResponseSchema.parse(await res.json());
  }

  private async postAuthed(path: string, timeout = 5000): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Bridge authentication failed — check your token');
      }
      const text = await res.text().catch(() => '');
      throw new Error(`Bridge error (${res.status}) on ${path}: ${text}`);
    }
    return res;
  }
}
