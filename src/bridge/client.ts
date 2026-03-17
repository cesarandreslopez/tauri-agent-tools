import type { BridgeConfig, ElementRect } from '../types.js';

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

    const data = await res.json();
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
    return JSON.parse(String(result));
  }

  async getViewportSize(): Promise<{ width: number; height: number }> {
    const js = `JSON.stringify({ width: window.innerWidth, height: window.innerHeight })`;
    const result = await this.eval(js);
    return JSON.parse(String(result));
  }

  async getDocumentTitle(): Promise<string> {
    const result = await this.eval('document.title');
    return String(result ?? '');
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
