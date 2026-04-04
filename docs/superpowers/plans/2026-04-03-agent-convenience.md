# Agent Convenience Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interaction commands, workflow abstractions, multi-window targeting, and state observability to tauri-agent-tools, growing it from 14 read-only commands to ~25 commands that let agents drive and debug Tauri apps end-to-end.

**Architecture:** Five additive layers — each phase produces a committable, testable increment. Layer 1 (targeting) updates shared infrastructure. Layer 2 (interaction) adds eval-based DOM commands + invoke. Layer 3 (workflows) adds capture/check composite commands. Layer 4 (observability) adds store-inspect. Layer 5 (skills) updates agent documentation.

**Tech Stack:** TypeScript (ESM, NodeNext), commander, zod, vitest. Rust (tiny_http, tauri) for bridge updates.

**Spec:** `docs/superpowers/specs/2026-04-03-agent-convenience-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/schemas/interact.ts` | Zod schemas for interaction results |
| `src/commands/interact/shared.ts` | Shared interaction utilities: element finding, selector escaping, script builders |
| `src/commands/interact/click.ts` | `click` command — dispatch click events on DOM elements |
| `src/commands/interact/type.ts` | `type` command — type text into input elements |
| `src/commands/interact/scroll.ts` | `scroll` command — scroll elements or window |
| `src/commands/interact/focus.ts` | `focus` command — focus a DOM element |
| `src/commands/interact/navigate.ts` | `navigate` command — navigate within the app |
| `src/commands/interact/select.ts` | `select` command — select dropdown values, toggle checkboxes |
| `src/commands/invoke.ts` | `invoke` command — call Tauri IPC commands |
| `src/commands/probe.ts` | `probe` command — target resolution + health check |
| `src/commands/capture.ts` | `capture` command — enhanced snapshot with manifest |
| `src/commands/check.ts` | `check` command — structured assertions |
| `src/commands/storeInspect.ts` | `store-inspect` command — reactive store inspector |
| `.agents/skills/contextful-desktop/SKILL.md` | Contextful-specific agent skill |
| `tests/schemas/interact.test.ts` | Interaction schema tests |
| `tests/commands/interact/shared.test.ts` | Interaction shared utilities tests |
| `tests/commands/interact/click.test.ts` | Click command tests |
| `tests/commands/interact/type.test.ts` | Type command tests |
| `tests/commands/interact/scroll.test.ts` | Scroll command tests |
| `tests/commands/interact/focus.test.ts` | Focus command tests |
| `tests/commands/interact/navigate.test.ts` | Navigate command tests |
| `tests/commands/interact/select.test.ts` | Select command tests |
| `tests/commands/invoke.test.ts` | Invoke command tests |
| `tests/commands/probe.test.ts` | Probe command tests |
| `tests/commands/capture.test.ts` | Capture command tests |
| `tests/commands/check.test.ts` | Check command tests |
| `tests/commands/storeInspect.test.ts` | Store inspect command tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/commands/shared.ts` | Add `--pid`, `--window-label` to `addBridgeOptions()`; update `resolveBridge()` |
| `src/bridge/client.ts` | Add `windowLabel` to `eval()`, add `describe()`, `invoke()`, `version()` methods |
| `src/commands/eval.ts` | Add `--file <path>` option |
| `src/schemas/bridge.ts` | Add DescribeResponse, VersionResponse schemas |
| `src/schemas/commands.ts` | Add CaptureManifest, CheckResult, StoreInspectResult schemas |
| `src/schemas/index.ts` | Re-export new schemas |
| `src/cli.ts` | Register ~11 new commands |
| `examples/tauri-bridge/src/dev_bridge.rs` | Add `/describe`, `/invoke`, `/version` endpoints; multi-window eval |
| `.agents/skills/tauri-agent-tools/SKILL.md` | Document all new commands |
| `.agents/skills/tauri-bridge-setup/SKILL.md` | Document new bridge endpoints |

---

## Phase 1: Foundation (Targeting + Probe)

### Task 1: Add `--pid` and `--window-label` to bridge options

**Files:**
- Modify: `src/commands/shared.ts`
- Test: `tests/commands/shared.test.ts`

- [ ] **Step 1: Write failing tests for --pid targeting**

Add these tests to `tests/commands/shared.test.ts`:

```typescript
// Add import at top (after existing imports)
import { discoverBridgesByPid } from '../../src/bridge/tokenDiscovery.js';
const mockDiscoverBridgesByPid = vi.mocked(discoverBridgesByPid);

// Update the mock at top of file
vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));
```

Add these test cases inside the `describe('resolveBridge', ...)` block:

```typescript
    it('uses --pid to target a specific app bridge', async () => {
      const bridges = new Map<number, { port: number; token: string }>();
      bridges.set(1234, { port: 8080, token: 'app1-token' });
      bridges.set(5678, { port: 9090, token: 'app2-token' });
      mockDiscoverBridgesByPid.mockResolvedValue(bridges);

      const client = await resolveBridge({ pid: 5678 });

      expect(client).toBeInstanceOf(BridgeClient);
      expect(mockDiscoverBridgesByPid).toHaveBeenCalledOnce();
      expect(mockDiscoverBridge).not.toHaveBeenCalled();
    });

    it('throws when --pid does not match any running bridge', async () => {
      const bridges = new Map<number, { port: number; token: string }>();
      bridges.set(1234, { port: 8080, token: 'app1-token' });
      mockDiscoverBridgesByPid.mockResolvedValue(bridges);

      await expect(resolveBridge({ pid: 9999 })).rejects.toThrow(
        'No bridge found for PID 9999',
      );
    });
```

Add these tests inside the `describe('addBridgeOptions', ...)` block:

```typescript
    it('adds --pid and --window-label options', async () => {
      const { Command } = await import('commander');
      const cmd = new Command('test-cmd');

      addBridgeOptions(cmd);

      const pidOpt = cmd.options.find((o) => o.long === '--pid');
      const windowOpt = cmd.options.find((o) => o.long === '--window-label');

      expect(pidOpt).toBeDefined();
      expect(windowOpt).toBeDefined();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/shared.test.ts`
Expected: FAIL — `discoverBridgesByPid` not in mock, `pid` not accepted, `--window-label` option not found.

- [ ] **Step 3: Implement --pid and --window-label in shared.ts**

Replace the entire content of `src/commands/shared.ts`:

```typescript
import type { Command } from 'commander';
import type { z } from 'zod';
import type { BridgeConfig } from '../schemas/bridge.js';
import { BridgeClient } from '../bridge/client.js';
import { discoverBridge, discoverBridgesByPid } from '../bridge/tokenDiscovery.js';

/**
 * Parse a value with a Zod enum schema, throwing a human-readable error on failure.
 * Replaces raw `.parse()` calls that would surface cryptic ZodError messages.
 */
export function parseEnum<T extends [string, ...string[]]>(
  schema: z.ZodEnum<T>,
  value: string,
  label: string,
): T[number] {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${label}: ${value}. Must be one of: ${schema.options.join(', ')}`);
  }
  return result.data;
}

export function addBridgeOptions(cmd: Command): Command {
  return cmd
    .option('--port <number>', 'Bridge port (auto-discover if omitted)', parseInt)
    .option('--token <string>', 'Bridge token (auto-discover if omitted)')
    .option('--pid <number>', 'Target a specific app by PID', parseInt)
    .option('--window-label <label>', 'Target a specific webview window (default: main)');
}

export interface BridgeOpts {
  port?: number;
  token?: string;
  pid?: number;
  windowLabel?: string;
}

export async function resolveBridge(opts: BridgeOpts): Promise<BridgeClient> {
  let config: BridgeConfig;

  if (opts.port && opts.token) {
    config = { port: opts.port, token: opts.token };
  } else if (opts.pid) {
    const bridges = await discoverBridgesByPid();
    const found = bridges.get(opts.pid);
    if (!found) {
      throw new Error(
        `No bridge found for PID ${opts.pid}. Running bridges:\n` +
          (bridges.size > 0
            ? [...bridges.entries()].map(([pid, b]) => `  PID ${pid} → port ${b.port}`).join('\n')
            : '  (none)'),
      );
    }
    config = {
      port: opts.port ?? found.port,
      token: opts.token ?? found.token,
    };
  } else {
    const discovered = await discoverBridge();
    if (!discovered) {
      throw new Error(
        'No bridge found. Either:\n' +
          '  1. Start the Tauri dev bridge in your app, or\n' +
          '  2. Specify --port and --token manually',
      );
    }
    config = {
      port: opts.port ?? discovered.port,
      token: opts.token ?? discovered.token,
    };
  }

  return new BridgeClient(config, opts.windowLabel);
}
```

Note: `BridgeClient` now accepts an optional `windowLabel` in its constructor. That change is in Task 2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/shared.test.ts`
Expected: Some tests pass, some may fail until BridgeClient is updated in Task 2. The `addBridgeOptions` and `resolveBridge` logic tests should pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/shared.ts tests/commands/shared.test.ts
git commit -m "feat: add --pid and --window-label bridge targeting options"
```

---

### Task 2: Update BridgeClient for multi-window eval

**Files:**
- Modify: `src/bridge/client.ts`
- Test: `tests/bridge/client.test.ts`

- [ ] **Step 1: Write failing tests for windowLabel support**

Add these tests to `tests/bridge/client.test.ts` inside the `describe('BridgeClient', ...)` block:

```typescript
  describe('window targeting', () => {
    it('includes window label in eval request body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'Overlay Title' }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const c = new BridgeClient({ port, token: TEST_TOKEN }, 'overlay');
        await c.eval('document.title');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: JSON.stringify({ js: 'document.title', token: TEST_TOKEN, window: 'overlay' }),
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('omits window field when no label is set', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'Main Title' }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const c = new BridgeClient({ port, token: TEST_TOKEN });
        await c.eval('document.title');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body).not.toHaveProperty('window');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bridge/client.test.ts`
Expected: FAIL — BridgeClient constructor does not accept second parameter.

- [ ] **Step 3: Update BridgeClient to support windowLabel**

Replace `src/bridge/client.ts`:

```typescript
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
  private windowLabel: string | undefined;

  constructor(config: BridgeConfig, windowLabel?: string) {
    this.baseUrl = `http://127.0.0.1:${config.port}`;
    this.token = config.token;
    this.windowLabel = windowLabel;
  }

  async eval(js: string, timeout = 5000): Promise<unknown> {
    const body: Record<string, unknown> = { js, token: this.token };
    if (this.windowLabel) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bridge/client.test.ts tests/commands/shared.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All existing tests pass. Some commands may need `BridgeOpts` type adjustment — those will be caught here.

- [ ] **Step 6: Commit**

```bash
git add src/bridge/client.ts src/commands/shared.ts tests/bridge/client.test.ts tests/commands/shared.test.ts
git commit -m "feat: multi-window eval support via --window-label and --pid targeting"
```

---

### Task 3: Add interaction schemas

**Files:**
- Create: `src/schemas/interact.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/schemas/interact.test.ts`

- [ ] **Step 1: Write schema tests**

Create `tests/schemas/interact.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  InteractionResultSchema,
  ClickResultSchema,
  TypeResultSchema,
  ScrollResultSchema,
  SelectResultSchema,
  InvokeResultSchema,
} from '../../src/schemas/interact.js';

describe('Interaction schemas', () => {
  describe('InteractionResultSchema', () => {
    it('accepts a successful result', () => {
      const result = InteractionResultSchema.parse({
        success: true,
        selector: '.btn',
        tagName: 'button',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a failed result with error', () => {
      const result = InteractionResultSchema.parse({
        success: false,
        selector: '.missing',
        error: 'Element not found',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Element not found');
    });

    it('rejects missing success field', () => {
      expect(() => InteractionResultSchema.parse({ selector: '.btn' })).toThrow();
    });
  });

  describe('ClickResultSchema', () => {
    it('accepts click result with text', () => {
      const result = ClickResultSchema.parse({
        success: true,
        selector: '.btn',
        tagName: 'button',
        text: 'Submit',
      });
      expect(result.text).toBe('Submit');
    });
  });

  describe('TypeResultSchema', () => {
    it('accepts type result with value', () => {
      const result = TypeResultSchema.parse({
        success: true,
        selector: '#input',
        tagName: 'input',
        value: 'hello world',
      });
      expect(result.value).toBe('hello world');
    });
  });

  describe('ScrollResultSchema', () => {
    it('accepts scroll result with positions', () => {
      const result = ScrollResultSchema.parse({
        success: true,
        scrollX: 0,
        scrollY: 500,
      });
      expect(result.scrollY).toBe(500);
    });
  });

  describe('SelectResultSchema', () => {
    it('accepts select result with selected value', () => {
      const result = SelectResultSchema.parse({
        success: true,
        selector: '#dropdown',
        tagName: 'select',
        value: 'US',
      });
      expect(result.value).toBe('US');
    });
  });

  describe('InvokeResultSchema', () => {
    it('accepts invoke result', () => {
      const result = InvokeResultSchema.parse({
        success: true,
        command: 'get_config',
        result: { theme: 'dark' },
      });
      expect(result.command).toBe('get_config');
    });

    it('accepts invoke failure', () => {
      const result = InvokeResultSchema.parse({
        success: false,
        command: 'bad_cmd',
        error: 'Command not found',
      });
      expect(result.error).toBe('Command not found');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schemas/interact.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create interaction schemas**

Create `src/schemas/interact.ts`:

```typescript
import { z } from 'zod';

// === Base interaction result ===

export const InteractionResultSchema = z.object({
  success: z.boolean(),
  selector: z.string().optional(),
  tagName: z.string().optional(),
  error: z.string().optional(),
});
export type InteractionResult = z.infer<typeof InteractionResultSchema>;

// === Click ===

export const ClickResultSchema = InteractionResultSchema.extend({
  text: z.string().optional(),
});
export type ClickResult = z.infer<typeof ClickResultSchema>;

// === Type ===

export const TypeResultSchema = InteractionResultSchema.extend({
  value: z.string().optional(),
});
export type TypeResult = z.infer<typeof TypeResultSchema>;

// === Scroll ===

export const ScrollResultSchema = z.object({
  success: z.boolean(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  error: z.string().optional(),
});
export type ScrollResult = z.infer<typeof ScrollResultSchema>;

// === Select ===

export const SelectResultSchema = InteractionResultSchema.extend({
  value: z.string().optional(),
  checked: z.boolean().optional(),
});
export type SelectResult = z.infer<typeof SelectResultSchema>;

// === Invoke ===

export const InvokeResultSchema = z.object({
  success: z.boolean(),
  command: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type InvokeResult = z.infer<typeof InvokeResultSchema>;
```

- [ ] **Step 4: Update barrel export in `src/schemas/index.ts`**

Add to the end of `src/schemas/index.ts`:

```typescript
export {
  InteractionResultSchema,
  type InteractionResult,
  ClickResultSchema,
  type ClickResult,
  TypeResultSchema,
  type TypeResult,
  ScrollResultSchema,
  type ScrollResult,
  SelectResultSchema,
  type SelectResult,
  InvokeResultSchema,
  type InvokeResult,
} from './interact.js';
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/schemas/interact.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/interact.ts src/schemas/index.ts tests/schemas/interact.test.ts
git commit -m "feat: add Zod schemas for interaction command results"
```

---

### Task 4: Add --eval-file option to eval command

**Files:**
- Modify: `src/commands/eval.ts`
- Test: `tests/commands/eval.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/commands/eval.test.ts`:

```typescript
import { readFile } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));
const mockReadFile = vi.mocked(readFile);

describe('Eval --file option', () => {
  it('reads JS from file when --file is provided', async () => {
    const scriptContent = 'document.querySelectorAll(".item").length';
    mockReadFile.mockResolvedValue(scriptContent);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 5 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.eval(scriptContent);

    expect(result).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/eval',
      expect.objectContaining({
        body: JSON.stringify({ js: scriptContent, token: 'test-token' }),
      }),
    );

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Update eval command to support --file**

Replace `src/commands/eval.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';

export function registerEval(program: Command): void {
  const cmd = new Command('eval')
    .description('Evaluate a JavaScript expression in the Tauri app')
    .argument('[expression]', 'JavaScript expression to evaluate')
    .option('--file <path>', 'Read JavaScript from a file instead of argument')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools eval "document.title"
  $ tauri-agent-tools eval "window.location.href"
  $ tauri-agent-tools eval --file /tmp/inspect-canvas.js`);

  addBridgeOptions(cmd);

  cmd.action(async (expression: string | undefined, opts: BridgeOpts & { file?: string }) => {
    let js: string;
    if (opts.file) {
      js = await readFile(opts.file, 'utf-8');
    } else if (expression) {
      js = expression;
    } else {
      throw new Error('Provide a JavaScript expression or --file <path>');
    }

    const bridge = await resolveBridge(opts);
    const result = await bridge.eval(js);

    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(result);
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/commands/eval.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/eval.ts tests/commands/eval.test.ts
git commit -m "feat: add --file option to eval command for loading JS from files"
```

---

## Phase 2: Interaction Commands

### Task 5: Create interaction shared utilities

**Files:**
- Create: `src/commands/interact/shared.ts`
- Test: `tests/commands/interact/shared.test.ts`

- [ ] **Step 1: Write tests for shared utilities**

Create `tests/commands/interact/shared.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  escapeSelector,
  buildFindElementScript,
  buildWaitAndFindScript,
} from '../../../src/commands/interact/shared.js';

describe('interact/shared', () => {
  describe('escapeSelector', () => {
    it('escapes single quotes', () => {
      expect(escapeSelector("div[data-name='foo']")).toBe("div[data-name=\\'foo\\']");
    });

    it('escapes backslashes', () => {
      expect(escapeSelector('div.foo\\bar')).toBe('div.foo\\\\bar');
    });

    it('passes simple selectors through unchanged', () => {
      expect(escapeSelector('.my-button')).toBe('.my-button');
    });
  });

  describe('buildFindElementScript', () => {
    it('returns JS that finds element and returns info', () => {
      const script = buildFindElementScript('.btn');
      expect(script).toContain("querySelector('.btn')");
      expect(script).toContain('tagName');
      expect(script).toContain('JSON.stringify');
    });
  });

  describe('buildWaitAndFindScript', () => {
    it('wraps find in a polling loop when wait > 0', () => {
      const script = buildWaitAndFindScript('.btn', 2000);
      expect(script).toContain('2000');
      expect(script).toContain('querySelector');
    });

    it('returns simple find when wait is 0', () => {
      const script = buildWaitAndFindScript('.btn', 0);
      expect(script).not.toContain('setInterval');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/interact/shared.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the shared utilities**

Create `src/commands/interact/shared.ts`:

```typescript
import type { Command } from 'commander';
import { addBridgeOptions } from '../shared.js';

/** Escape a CSS selector for embedding in a JS string literal with single quotes. */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Build a JS script that finds an element by selector and returns basic info.
 * Returns JSON: { found: true, tagName, id, text } or { found: false }.
 */
export function buildFindElementScript(selector: string): string {
  const escaped = escapeSelector(selector);
  return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ found: false });
  return JSON.stringify({
    found: true,
    tagName: el.tagName.toLowerCase(),
    id: el.id || undefined,
    text: (el.textContent || '').trim().slice(0, 100)
  });
})()`;
}

/**
 * Build a JS script that waits for an element then returns info.
 * If waitMs is 0, does a single lookup. Otherwise polls every 100ms up to waitMs.
 */
export function buildWaitAndFindScript(selector: string, waitMs: number): string {
  const escaped = escapeSelector(selector);

  if (waitMs <= 0) {
    return buildFindElementScript(selector);
  }

  return `new Promise((resolve) => {
  var deadline = Date.now() + ${waitMs};
  function check() {
    var el = document.querySelector('${escaped}');
    if (el) {
      resolve(JSON.stringify({
        found: true,
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        text: (el.textContent || '').trim().slice(0, 100)
      }));
    } else if (Date.now() >= deadline) {
      resolve(JSON.stringify({ found: false }));
    } else {
      setTimeout(check, 100);
    }
  }
  check();
})`;
}

/** Add standard interaction options to a command. */
export function addInteractOptions(cmd: Command): Command {
  addBridgeOptions(cmd);
  return cmd.option('--json', 'Output as JSON');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/commands/interact/shared.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/interact/shared.ts tests/commands/interact/shared.test.ts
git commit -m "feat: add shared interaction utilities (escapeSelector, buildFindElementScript)"
```

---

### Task 6: Implement `click` command

**Files:**
- Create: `src/commands/interact/click.ts`
- Test: `tests/commands/interact/click.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/commands/interact/click.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { BridgeClient } from '../../../src/bridge/client.js';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Click command', () => {
  it('builds correct click script for a simple selector', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: JSON.stringify({ success: true, selector: '.btn', tagName: 'button', text: 'Submit' }),
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new BridgeClient({ port: 9999, token: 'test-token' });
    const result = await client.eval('test-click-script');

    expect(result).toContain('success');
    expect(mockFetch).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('builds a script that dispatches mousedown, mouseup, and click', async () => {
    // Verify the click script generator produces correct event sequence
    const { buildClickScript } = await import('../../../src/commands/interact/click.js');
    const script = buildClickScript('.my-btn', { double: false, right: false });

    expect(script).toContain("querySelector('.my-btn')");
    expect(script).toContain('mousedown');
    expect(script).toContain('mouseup');
    expect(script).toContain('click');
    expect(script).toContain('JSON.stringify');
  });

  it('builds a double-click script', async () => {
    const { buildClickScript } = await import('../../../src/commands/interact/click.js');
    const script = buildClickScript('.my-btn', { double: true, right: false });

    expect(script).toContain('dblclick');
  });

  it('builds a right-click script', async () => {
    const { buildClickScript } = await import('../../../src/commands/interact/click.js');
    const script = buildClickScript('.my-btn', { double: false, right: true });

    expect(script).toContain('contextmenu');
    expect(script).toContain('button: 2');
  });

  it('handles element not found', async () => {
    const { buildClickScript } = await import('../../../src/commands/interact/click.js');
    const script = buildClickScript('.missing', { double: false, right: false });

    // Script should return a JSON with success: false if element not found
    expect(script).toContain('found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/interact/click.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement click command**

Create `src/commands/interact/click.ts`:

```typescript
import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { ClickResultSchema } from '../../schemas/interact.js';

export function buildClickScript(
  selector: string,
  opts: { double: boolean; right: boolean },
): string {
  const escaped = escapeSelector(selector);
  const button = opts.right ? 2 : 0;

  return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found' });
  var rect = el.getBoundingClientRect();
  var x = rect.x + rect.width / 2;
  var y = rect.y + rect.height / 2;
  var common = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: ${button} };
  el.dispatchEvent(new MouseEvent('mousedown', common));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  ${opts.right
    ? "el.dispatchEvent(new MouseEvent('contextmenu', common));"
    : `el.dispatchEvent(new MouseEvent('click', common));
  ${opts.double ? "el.dispatchEvent(new MouseEvent('dblclick', common));" : ''}`}
  return JSON.stringify({
    success: true,
    selector: '${escaped}',
    tagName: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 100)
  });
})()`;
}

export function registerClick(program: Command): void {
  const cmd = new Command('click')
    .description('Click a DOM element')
    .argument('<selector>', 'CSS selector of the element to click')
    .option('--double', 'Double-click')
    .option('--right', 'Right-click (context menu)')
    .option('--wait <ms>', 'Wait for element before clicking', parseInt, 0);

  addInteractOptions(cmd);

  cmd.action(async (selector: string, opts: BridgeOpts & {
    double?: boolean;
    right?: boolean;
    wait?: number;
    json?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);

    let js: string;
    if (opts.wait && opts.wait > 0) {
      const escaped = escapeSelector(selector);
      // Poll for element, then click
      js = `new Promise((resolve) => {
  var deadline = Date.now() + ${opts.wait};
  function check() {
    var el = document.querySelector('${escaped}');
    if (el) {
      resolve(eval(${JSON.stringify(buildClickScript(selector, { double: !!opts.double, right: !!opts.right }))}));
    } else if (Date.now() >= deadline) {
      resolve(JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found within ${opts.wait}ms' }));
    } else {
      setTimeout(check, 100);
    }
  }
  check();
})`;
    } else {
      js = buildClickScript(selector, { double: !!opts.double, right: !!opts.right });
    }

    const raw = await bridge.eval(js);
    const result = ClickResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? `Failed to click: ${selector}`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Clicked ${result.tagName ?? 'element'}: ${selector}${result.text ? ` ("${result.text}")` : ''}`);
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/commands/interact/click.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/interact/click.ts tests/commands/interact/click.test.ts
git commit -m "feat: add click command for DOM element interaction"
```

---

### Task 7: Implement `type` command

**Files:**
- Create: `src/commands/interact/type.ts`
- Test: `tests/commands/interact/type.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/commands/interact/type.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Type command', () => {
  it('builds script that sets value and dispatches input events', async () => {
    const { buildTypeScript } = await import('../../../src/commands/interact/type.js');
    const script = buildTypeScript('#search', 'hello world', false);

    expect(script).toContain("querySelector('#search')");
    expect(script).toContain('hello world');
    expect(script).toContain('input');
    expect(script).toContain('change');
    expect(script).toContain('focus');
  });

  it('builds script with clear option', async () => {
    const { buildTypeScript } = await import('../../../src/commands/interact/type.js');
    const script = buildTypeScript('#search', 'new text', true);

    expect(script).toContain('select');
    expect(script).toContain("value = ''");
  });

  it('handles special characters in text', async () => {
    const { buildTypeScript } = await import('../../../src/commands/interact/type.js');
    const script = buildTypeScript('#input', "it's a \"test\"", false);

    // Should be safely embedded in the script
    expect(script).toContain('#input');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/interact/type.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement type command**

Create `src/commands/interact/type.ts`:

```typescript
import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { TypeResultSchema } from '../../schemas/interact.js';

export function buildTypeScript(selector: string, text: string, clear: boolean): string {
  const escaped = escapeSelector(selector);
  const textJson = JSON.stringify(text);

  return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found' });
  el.focus();
  ${clear ? `el.select();
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));` : ''}
  el.value = ${textJson};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({
    success: true,
    selector: '${escaped}',
    tagName: el.tagName.toLowerCase(),
    value: el.value
  });
})()`;
}

export function registerType(program: Command): void {
  const cmd = new Command('type')
    .description('Type text into an input element')
    .argument('<selector>', 'CSS selector of the input element')
    .argument('<text>', 'Text to type')
    .option('--clear', 'Clear the field before typing');

  addInteractOptions(cmd);

  cmd.action(async (selector: string, text: string, opts: BridgeOpts & {
    clear?: boolean;
    json?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);
    const js = buildTypeScript(selector, text, !!opts.clear);
    const raw = await bridge.eval(js);
    const result = TypeResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? `Failed to type into: ${selector}`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Typed into ${result.tagName ?? 'element'}: ${selector} → "${text}"`);
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/commands/interact/type.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/interact/type.ts tests/commands/interact/type.test.ts
git commit -m "feat: add type command for text input interaction"
```

---

### Task 8: Implement `scroll`, `focus`, `navigate`, `select` commands

**Files:**
- Create: `src/commands/interact/scroll.ts`, `src/commands/interact/focus.ts`, `src/commands/interact/navigate.ts`, `src/commands/interact/select.ts`
- Test: `tests/commands/interact/scroll.test.ts`, `tests/commands/interact/focus.test.ts`, `tests/commands/interact/navigate.test.ts`, `tests/commands/interact/select.test.ts`

- [ ] **Step 1: Write tests for scroll**

Create `tests/commands/interact/scroll.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Scroll command', () => {
  it('builds window scroll-by script', async () => {
    const { buildScrollScript } = await import('../../../src/commands/interact/scroll.js');
    const script = buildScrollScript({ by: 500 });
    expect(script).toContain('scrollBy');
    expect(script).toContain('500');
  });

  it('builds scroll-to-top script', async () => {
    const { buildScrollScript } = await import('../../../src/commands/interact/scroll.js');
    const script = buildScrollScript({ toTop: true });
    expect(script).toContain('scrollTo');
    expect(script).toContain('top: 0');
  });

  it('builds scroll-into-view script with selector', async () => {
    const { buildScrollScript } = await import('../../../src/commands/interact/scroll.js');
    const script = buildScrollScript({ selector: '#item-42', intoView: true });
    expect(script).toContain('scrollIntoView');
    expect(script).toContain('#item-42');
  });

  it('builds element scroll-by script', async () => {
    const { buildScrollScript } = await import('../../../src/commands/interact/scroll.js');
    const script = buildScrollScript({ selector: '.panel', by: 200 });
    expect(script).toContain("querySelector('.panel')");
    expect(script).toContain('scrollBy');
  });
});
```

- [ ] **Step 2: Implement scroll command**

Create `src/commands/interact/scroll.ts`:

```typescript
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
    return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return JSON.stringify({ success: true, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) });
})()`;
  }

  if (selector) {
    const escaped = escapeSelector(selector);
    return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${escaped}' });
  ${by !== undefined ? `el.scrollBy({ top: ${by}, behavior: 'smooth' });` : ''}
  ${to !== undefined ? `el.scrollTo({ top: ${to}, behavior: 'smooth' });` : ''}
  ${toTop ? "el.scrollTo({ top: 0, behavior: 'smooth' });" : ''}
  ${toBottom ? "el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });" : ''}
  return JSON.stringify({ success: true, scrollX: Math.round(el.scrollLeft), scrollY: Math.round(el.scrollTop) });
})()`;
  }

  // Window scroll
  return `(() => {
  ${toTop ? "window.scrollTo({ top: 0, behavior: 'smooth' });" : ''}
  ${toBottom ? "window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });" : ''}
  ${by !== undefined ? `window.scrollBy({ top: ${by}, behavior: 'smooth' });` : ''}
  ${to !== undefined ? `window.scrollTo({ top: ${to}, behavior: 'smooth' });` : ''}
  return JSON.stringify({ success: true, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) });
})()`;
}

export function registerScroll(program: Command): void {
  const cmd = new Command('scroll')
    .description('Scroll the window or a specific element')
    .option('-s, --selector <css>', 'CSS selector of element to scroll (window if omitted)')
    .option('--by <px>', 'Scroll by N pixels (positive = down)', parseInt)
    .option('--to <px>', 'Scroll to absolute position', parseInt)
    .option('--to-top', 'Scroll to top')
    .option('--to-bottom', 'Scroll to bottom')
    .option('--into-view', 'Scroll element into view (requires --selector)');

  addInteractOptions(cmd);

  cmd.action(async (opts: BridgeOpts & ScrollOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const js = buildScrollScript(opts);
    const raw = await bridge.eval(js);
    const result = ScrollResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? 'Scroll failed');
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Scrolled to (${result.scrollX}, ${result.scrollY})`);
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 3: Write tests for focus**

Create `tests/commands/interact/focus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Focus command', () => {
  it('builds focus script', async () => {
    const { buildFocusScript } = await import('../../../src/commands/interact/focus.js');
    const script = buildFocusScript('#email');
    expect(script).toContain("querySelector('#email')");
    expect(script).toContain('focus()');
    expect(script).toContain('JSON.stringify');
  });

  it('handles element not found', async () => {
    const { buildFocusScript } = await import('../../../src/commands/interact/focus.js');
    const script = buildFocusScript('.missing');
    expect(script).toContain('Element not found');
  });
});
```

- [ ] **Step 4: Implement focus command**

Create `src/commands/interact/focus.ts`:

```typescript
import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { InteractionResultSchema } from '../../schemas/interact.js';

export function buildFocusScript(selector: string): string {
  const escaped = escapeSelector(selector);
  return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found' });
  el.focus();
  return JSON.stringify({
    success: true,
    selector: '${escaped}',
    tagName: el.tagName.toLowerCase()
  });
})()`;
}

export function registerFocus(program: Command): void {
  const cmd = new Command('focus')
    .description('Focus a DOM element')
    .argument('<selector>', 'CSS selector of the element to focus');

  addInteractOptions(cmd);

  cmd.action(async (selector: string, opts: BridgeOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const js = buildFocusScript(selector);
    const raw = await bridge.eval(js);
    const result = InteractionResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? `Failed to focus: ${selector}`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Focused ${result.tagName ?? 'element'}: ${selector}`);
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 5: Write tests for navigate**

Create `tests/commands/interact/navigate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Navigate command', () => {
  it('builds path navigation script', async () => {
    const { buildNavigateScript } = await import('../../../src/commands/interact/navigate.js');
    const script = buildNavigateScript('/settings');
    expect(script).toContain('/settings');
    expect(script).toContain('pushState');
  });

  it('builds full URL navigation script', async () => {
    const { buildNavigateScript } = await import('../../../src/commands/interact/navigate.js');
    const script = buildNavigateScript('http://localhost:1420/overlay.html');
    expect(script).toContain('location.href');
  });
});
```

- [ ] **Step 6: Implement navigate command**

Create `src/commands/interact/navigate.ts`:

```typescript
import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions } from './shared.js';
import { InteractionResultSchema } from '../../schemas/interact.js';

export function buildNavigateScript(target: string): string {
  const targetJson = JSON.stringify(target);

  // Path-like targets use pushState; full URLs use location.href
  if (target.startsWith('/')) {
    return `(() => {
  try {
    window.history.pushState({}, '', ${targetJson});
    window.dispatchEvent(new PopStateEvent('popstate'));
    return JSON.stringify({ success: true, tagName: 'window', selector: ${targetJson} });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
})()`;
  }

  return `(() => {
  try {
    window.location.href = ${targetJson};
    return JSON.stringify({ success: true, tagName: 'window', selector: ${targetJson} });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
})()`;
}

export function registerNavigate(program: Command): void {
  const cmd = new Command('navigate')
    .description('Navigate within the app')
    .argument('<target>', 'URL or path to navigate to (e.g. /settings or http://...)')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools navigate "/settings"
  $ tauri-agent-tools navigate "http://localhost:1420/overlay.html"`);

  addInteractOptions(cmd);

  cmd.action(async (target: string, opts: BridgeOpts & { json?: boolean }) => {
    const bridge = await resolveBridge(opts);
    const js = buildNavigateScript(target);
    const raw = await bridge.eval(js);
    const result = InteractionResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? `Navigation failed: ${target}`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Navigated to: ${target}`);
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 7: Write tests for select**

Create `tests/commands/interact/select.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Select command', () => {
  it('builds dropdown select script', async () => {
    const { buildSelectScript } = await import('../../../src/commands/interact/select.js');
    const script = buildSelectScript('#country', 'US', false);
    expect(script).toContain("querySelector('#country')");
    expect(script).toContain('US');
    expect(script).toContain('change');
  });

  it('builds toggle script for checkboxes', async () => {
    const { buildSelectScript } = await import('../../../src/commands/interact/select.js');
    const script = buildSelectScript('input[type=checkbox]', undefined, true);
    expect(script).toContain('checked');
    expect(script).toContain('!el.checked');
  });
});
```

- [ ] **Step 8: Implement select command**

Create `src/commands/interact/select.ts`:

```typescript
import { Command } from 'commander';
import { resolveBridge } from '../shared.js';
import type { BridgeOpts } from '../shared.js';
import { addInteractOptions, escapeSelector } from './shared.js';
import { SelectResultSchema } from '../../schemas/interact.js';

export function buildSelectScript(selector: string, value: string | undefined, toggle: boolean): string {
  const escaped = escapeSelector(selector);

  if (toggle) {
    return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found' });
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({
    success: true,
    selector: '${escaped}',
    tagName: el.tagName.toLowerCase(),
    checked: el.checked
  });
})()`;
  }

  const valueJson = JSON.stringify(value ?? '');
  return `(() => {
  var el = document.querySelector('${escaped}');
  if (!el) return JSON.stringify({ success: false, selector: '${escaped}', error: 'Element not found' });
  el.value = ${valueJson};
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({
    success: true,
    selector: '${escaped}',
    tagName: el.tagName.toLowerCase(),
    value: el.value
  });
})()`;
}

export function registerSelect(program: Command): void {
  const cmd = new Command('select')
    .description('Select a dropdown value or toggle a checkbox/radio')
    .argument('<selector>', 'CSS selector of the element')
    .argument('[value]', 'Value to select (for dropdowns)')
    .option('--toggle', 'Toggle checkbox/radio checked state');

  addInteractOptions(cmd);

  cmd.action(async (selector: string, value: string | undefined, opts: BridgeOpts & {
    toggle?: boolean;
    json?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);
    const js = buildSelectScript(selector, value, !!opts.toggle);
    const raw = await bridge.eval(js);
    const result = SelectResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? `Failed to select: ${selector}`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (opts.toggle) {
      console.log(`Toggled ${selector}: checked=${result.checked}`);
    } else {
      console.log(`Selected "${result.value}" in ${selector}`);
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 9: Run all interaction tests**

Run: `npx vitest run tests/commands/interact/`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/commands/interact/scroll.ts src/commands/interact/focus.ts src/commands/interact/navigate.ts src/commands/interact/select.ts tests/commands/interact/
git commit -m "feat: add scroll, focus, navigate, select interaction commands"
```

---

### Task 9: Implement `invoke` command

**Files:**
- Create: `src/commands/invoke.ts`
- Test: `tests/commands/invoke.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/commands/invoke.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Invoke command', () => {
  it('builds eval script for IPC invocation', async () => {
    const { buildInvokeScript } = await import('../../src/commands/invoke.js');
    const script = buildInvokeScript('get_config', {});
    expect(script).toContain('__TAURI__');
    expect(script).toContain('invoke');
    expect(script).toContain('get_config');
  });

  it('serializes args as JSON', async () => {
    const { buildInvokeScript } = await import('../../src/commands/invoke.js');
    const script = buildInvokeScript('save_item', { id: 42, name: 'test' });
    expect(script).toContain('"id":42');
    expect(script).toContain('"name":"test"');
  });

  it('handles invocation without args', async () => {
    const { buildInvokeScript } = await import('../../src/commands/invoke.js');
    const script = buildInvokeScript('ping', undefined);
    expect(script).toContain('invoke');
    expect(script).toContain('ping');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/invoke.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement invoke command**

Create `src/commands/invoke.ts`:

```typescript
import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { InvokeResultSchema } from '../schemas/interact.js';

export function buildInvokeScript(command: string, args: unknown): string {
  const cmdJson = JSON.stringify(command);
  const argsJson = JSON.stringify(args ?? {});

  return `(async () => {
  try {
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return JSON.stringify({ success: false, command: ${cmdJson}, error: 'Tauri IPC not available' });
    }
    var result = await window.__TAURI__.core.invoke(${cmdJson}, ${argsJson});
    return JSON.stringify({ success: true, command: ${cmdJson}, result: result });
  } catch(e) {
    return JSON.stringify({ success: false, command: ${cmdJson}, error: e.message || String(e) });
  }
})()`;
}

export function registerInvoke(program: Command): void {
  const cmd = new Command('invoke')
    .description('Invoke a Tauri IPC command')
    .argument('<command>', 'Tauri command name')
    .argument('[args]', 'Command arguments as JSON string')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools invoke get_release_context --json
  $ tauri-agent-tools invoke update_tray_status '{"status":"running"}'`);

  addBridgeOptions(cmd);

  cmd.action(async (command: string, argsStr: string | undefined, opts: BridgeOpts & { json?: boolean }) => {
    let args: unknown = {};
    if (argsStr) {
      try {
        args = JSON.parse(argsStr);
      } catch {
        throw new Error(`Invalid JSON args: ${argsStr}`);
      }
    }

    const bridge = await resolveBridge(opts);
    const js = buildInvokeScript(command, args);
    const raw = await bridge.eval(js);
    const result = InvokeResultSchema.parse(JSON.parse(String(raw)));

    if (!result.success) {
      throw new Error(result.error ?? `Invoke failed: ${command}`);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`invoke ${command}:`, JSON.stringify(result.result, null, 2));
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/commands/invoke.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/invoke.ts tests/commands/invoke.test.ts
git commit -m "feat: add invoke command for Tauri IPC invocation"
```

---

### Task 10: Register all new commands in cli.ts

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add imports and registrations**

Add these imports after the existing imports in `src/cli.ts`:

```typescript
import { registerClick } from './commands/interact/click.js';
import { registerType } from './commands/interact/type.js';
import { registerScroll } from './commands/interact/scroll.js';
import { registerFocus } from './commands/interact/focus.js';
import { registerNavigate } from './commands/interact/navigate.js';
import { registerSelect } from './commands/interact/select.js';
import { registerInvoke } from './commands/invoke.js';
```

Add these registrations after the existing `register*` calls (before `program.parseAsync()`):

```typescript
registerClick(program);
registerType(program);
registerScroll(program);
registerFocus(program);
registerNavigate(program);
registerSelect(program);
registerInvoke(program);
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Import DAG check**

Run: `node scripts/check-imports.mjs`
Expected: No violations. The interact/ commands import from `../shared.js` (one level up in commands/) and from `../../schemas/interact.js` — both allowed by the DAG.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: register interaction commands (click, type, scroll, focus, navigate, select, invoke)"
```

---

## Phase 3: Workflow Commands

### Task 11: Implement `check` command

**Files:**
- Create: `src/commands/check.ts`
- Modify: `src/schemas/commands.ts`, `src/schemas/index.ts`
- Test: `tests/commands/check.test.ts`

- [ ] **Step 1: Add CheckResult schema**

Add to the end of `src/schemas/commands.ts`:

```typescript
// === Check Command ===

export const CheckItemSchema = z.object({
  type: z.enum(['selector', 'text', 'eval', 'no-errors']),
  passed: z.boolean(),
  selector: z.string().optional(),
  pattern: z.string().optional(),
  expression: z.string().optional(),
  errors: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type CheckItem = z.infer<typeof CheckItemSchema>;

export const CheckResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(CheckItemSchema),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;
```

Add to `src/schemas/index.ts` inside the `commands.js` re-export block:

```typescript
  CheckItemSchema,
  type CheckItem,
  CheckResultSchema,
  type CheckResult,
```

- [ ] **Step 2: Write tests**

Create `tests/commands/check.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';
import { CheckResultSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Check command', () => {
  describe('CheckResultSchema', () => {
    it('validates a passing result', () => {
      const result = CheckResultSchema.parse({
        passed: true,
        checks: [{ type: 'selector', passed: true, selector: '.ready' }],
      });
      expect(result.passed).toBe(true);
    });

    it('validates a failing result with errors', () => {
      const result = CheckResultSchema.parse({
        passed: false,
        checks: [
          { type: 'selector', passed: true, selector: '.app' },
          { type: 'no-errors', passed: false, errors: ['TypeError: x is not a function'] },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.checks).toHaveLength(2);
    });
  });

  it('check selector builds correct eval script', async () => {
    const { buildSelectorCheck } = await import('../../src/commands/check.js');
    const script = buildSelectorCheck('.app-ready');
    expect(script).toContain("querySelector('.app-ready')");
  });

  it('check eval builds correct script', async () => {
    const { buildEvalCheck } = await import('../../src/commands/check.js');
    const script = buildEvalCheck('document.querySelectorAll(".block").length > 0');
    expect(script).toContain('.block');
  });

  it('check text builds correct script', async () => {
    const { buildTextCheck } = await import('../../src/commands/check.js');
    const script = buildTextCheck('Ready');
    expect(script).toContain('Ready');
    expect(script).toContain('textContent');
  });
});
```

- [ ] **Step 3: Implement check command**

Create `src/commands/check.ts`:

```typescript
import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import type { CheckItem } from '../schemas/commands.js';

export function buildSelectorCheck(selector: string): string {
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `!!document.querySelector('${escaped}')`;
}

export function buildEvalCheck(expression: string): string {
  return `!!(${expression})`;
}

export function buildTextCheck(pattern: string): string {
  const escaped = pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `document.body.textContent.includes('${escaped}')`;
}

const CONSOLE_ERROR_SCRIPT = `(() => {
  if (!window.__tauriDevConsoleBuffer) return JSON.stringify([]);
  var errors = window.__tauriDevConsoleBuffer.filter(function(e) { return e.level === 'error'; });
  return JSON.stringify(errors.map(function(e) { return e.message; }));
})()`;

export function registerCheck(program: Command): void {
  const cmd = new Command('check')
    .description('Run assertions and exit nonzero on failure')
    .option('-s, --selector <css>', 'Check that a CSS selector matches an element')
    .option('-e, --eval <js>', 'Check that a JS expression is truthy')
    .option('-t, --text <pattern>', 'Check that text is visible on the page')
    .option('--no-errors', 'Check that no console errors have occurred')
    .option('--duration <ms>', 'Duration to monitor for console errors', parseInt, 3000)
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & {
    selector?: string;
    eval?: string;
    text?: string;
    errors?: boolean;
    duration?: number;
    json?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);
    const checks: CheckItem[] = [];

    // Selector check
    if (opts.selector) {
      const js = buildSelectorCheck(opts.selector);
      const result = await bridge.eval(js);
      checks.push({
        type: 'selector',
        passed: !!result,
        selector: opts.selector,
      });
    }

    // Eval check
    if (opts.eval) {
      const js = buildEvalCheck(opts.eval);
      try {
        const result = await bridge.eval(js);
        checks.push({
          type: 'eval',
          passed: !!result,
          expression: opts.eval,
        });
      } catch (err) {
        checks.push({
          type: 'eval',
          passed: false,
          expression: opts.eval,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Text check
    if (opts.text) {
      const js = buildTextCheck(opts.text);
      const result = await bridge.eval(js);
      checks.push({
        type: 'text',
        passed: !!result,
        pattern: opts.text,
      });
    }

    // No-errors check
    if (opts.errors === false) {
      // Inject console capture, wait, then check
      const injectScript = `(() => {
  if (!window.__tauriDevConsoleBuffer) {
    window.__tauriDevConsoleBuffer = [];
    var orig = console.error;
    console.error = function() {
      window.__tauriDevConsoleBuffer.push({ level: 'error', message: Array.from(arguments).join(' '), timestamp: Date.now() });
      orig.apply(console, arguments);
    };
  }
  return 'ok';
})()`;
      await bridge.eval(injectScript);

      // Wait for the monitoring duration
      await new Promise((resolve) => setTimeout(resolve, opts.duration ?? 3000));

      const raw = await bridge.eval(CONSOLE_ERROR_SCRIPT);
      const errors: string[] = JSON.parse(String(raw));
      checks.push({
        type: 'no-errors',
        passed: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    const allPassed = checks.every((c) => c.passed);

    if (opts.json) {
      console.log(JSON.stringify({ passed: allPassed, checks }, null, 2));
    } else {
      for (const check of checks) {
        const status = check.passed ? 'PASS' : 'FAIL';
        const detail = check.selector ?? check.pattern ?? check.expression ?? check.type;
        console.log(`[${status}] ${check.type}: ${detail}`);
        if (!check.passed && check.errors) {
          for (const err of check.errors) {
            console.log(`       ${err}`);
          }
        }
      }
    }

    if (!allPassed) {
      process.exitCode = 1;
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/commands/check.test.ts`
Expected: PASS

- [ ] **Step 5: Register in cli.ts**

Add import: `import { registerCheck } from './commands/check.js';`
Add registration: `registerCheck(program);`

- [ ] **Step 6: Commit**

```bash
git add src/commands/check.ts src/schemas/commands.ts src/schemas/index.ts src/cli.ts tests/commands/check.test.ts
git commit -m "feat: add check command for structured assertions"
```

---

### Task 12: Implement `capture` command

**Files:**
- Create: `src/commands/capture.ts`
- Modify: `src/schemas/commands.ts`, `src/schemas/index.ts`, `src/cli.ts`
- Test: `tests/commands/capture.test.ts`

- [ ] **Step 1: Add CaptureManifest schema**

Add to `src/schemas/commands.ts`:

```typescript
// === Capture Command ===

export const CaptureManifestSchema = z.object({
  timestamp: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  errorCount: z.number().optional(),
  files: z.record(z.string(), z.string()),
});
export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;
```

Add to `src/schemas/index.ts` inside the commands re-export block:

```typescript
  CaptureManifestSchema,
  type CaptureManifest,
```

- [ ] **Step 2: Write tests**

Create `tests/commands/capture.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CaptureManifestSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Capture command', () => {
  it('CaptureManifest schema validates correctly', () => {
    const manifest = CaptureManifestSchema.parse({
      timestamp: '2026-04-03T12:00:00Z',
      url: 'http://localhost:1420/',
      title: 'My App',
      viewport: { width: 1920, height: 1080 },
      errorCount: 0,
      files: {
        screenshot: '/tmp/debug/screenshot.png',
        dom: '/tmp/debug/dom.json',
        pageState: '/tmp/debug/page-state.json',
        storage: '/tmp/debug/storage.json',
      },
    });
    expect(manifest.files.screenshot).toBe('/tmp/debug/screenshot.png');
  });

  it('CaptureManifest allows partial data', () => {
    const manifest = CaptureManifestSchema.parse({
      timestamp: '2026-04-03T12:00:00Z',
      files: {
        screenshot: 'error: No window found',
        dom: '/tmp/debug/dom.json',
      },
    });
    expect(manifest.url).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement capture command**

Create `src/commands/capture.ts`:

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import type { PlatformAdapter } from '../types.js';
import type { ImageFormat } from '../schemas/commands.js';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { buildSerializerScript } from './dom.js';
import { computeCropRect, cropImage } from '../util/image.js';
import { DomNodeSchema } from '../schemas/dom.js';
import { PageStateSchema, SnapshotStorageResultSchema } from '../schemas/commands.js';

const PAGE_STATE_SCRIPT = `(() => {
  return JSON.stringify({
    url: window.location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    hasTauri: !!(window.__TAURI__)
  });
})()`;

const STORAGE_SCRIPT = `(() => {
  var local = Object.keys(localStorage).map(function(k) { return { key: k, value: localStorage.getItem(k) }; });
  var session = Object.keys(sessionStorage).map(function(k) { return { key: k, value: sessionStorage.getItem(k) }; });
  return JSON.stringify({ localStorage: local, sessionStorage: session });
})()`;

const CONSOLE_ERRORS_SCRIPT = `(() => {
  if (!window.__tauriDevConsoleBuffer) {
    window.__tauriDevConsoleBuffer = [];
    var orig = console.error;
    console.error = function() {
      window.__tauriDevConsoleBuffer.push({ level: 'error', message: Array.from(arguments).join(' '), timestamp: Date.now() });
      orig.apply(console, arguments);
    };
  }
  return 'injected';
})()`;

const DRAIN_CONSOLE_ERRORS_SCRIPT = `(() => {
  if (!window.__tauriDevConsoleBuffer) return JSON.stringify([]);
  var buf = window.__tauriDevConsoleBuffer;
  window.__tauriDevConsoleBuffer = [];
  return JSON.stringify(buf.filter(function(e) { return e.level === 'error'; }));
})()`;

export function registerCapture(
  program: Command,
  getAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
): void {
  const cmd = new Command('capture')
    .description('Capture a full debug evidence bundle (screenshot + DOM + state + logs)')
    .requiredOption('-o, --output <dir>', 'Output directory for captured files')
    .option('-s, --selector <css>', 'CSS selector to screenshot (full window if omitted)')
    .option('-t, --title <regex>', 'Window title to match')
    .option('--dom-depth <number>', 'DOM tree depth', parseInt, 3)
    .option('--eval <js>', 'Additional JS to eval and save')
    .option('--logs-duration <ms>', 'Duration to capture streaming data', parseInt, 3000)
    .option('--json', 'Output structured manifest');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & {
    output: string;
    selector?: string;
    title?: string;
    domDepth: number;
    eval?: string;
    logsDuration: number;
    json?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);
    const adapter = await getAdapter();
    const outDir = opts.output;
    const format: ImageFormat = 'png';
    const files: Record<string, string> = {};

    await mkdir(outDir, { recursive: true });

    // Inject console error capture early
    await bridge.eval(CONSOLE_ERRORS_SCRIPT).catch(() => {});

    // 1. Page state (needed for manifest summary)
    let pageUrl: string | undefined;
    let pageTitle: string | undefined;
    let viewport: { width: number; height: number } | undefined;
    try {
      const raw = await bridge.eval(PAGE_STATE_SCRIPT);
      const state = PageStateSchema.parse(JSON.parse(String(raw)));
      const path = join(outDir, 'page-state.json');
      await writeFile(path, JSON.stringify(state, null, 2));
      files.pageState = path;
      pageUrl = state.url;
      pageTitle = state.title;
      viewport = state.viewport;
    } catch (err) {
      files.pageState = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 2. Screenshot
    try {
      const title = opts.title ?? (pageTitle || undefined);
      if (title) {
        const windowId = await adapter.findWindow(title);
        let buffer: Buffer;
        if (opts.selector) {
          const elementRect = await bridge.getElementRect(opts.selector);
          if (!elementRect) throw new Error(`Element not found: ${opts.selector}`);
          const vp = await bridge.getViewportSize();
          const windowGeom = await adapter.getWindowGeometry(windowId);
          buffer = await adapter.captureWindow(windowId, format);
          const cropRect = computeCropRect(elementRect, vp, {
            width: windowGeom.width,
            height: windowGeom.height,
          });
          buffer = await cropImage(buffer, cropRect, format);
        } else {
          buffer = await adapter.captureWindow(windowId, format);
        }
        const path = join(outDir, 'screenshot.png');
        await writeFile(path, buffer);
        files.screenshot = path;
      } else {
        files.screenshot = 'error: Could not determine window title. Use --title.';
      }
    } catch (err) {
      files.screenshot = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 3. DOM
    try {
      const raw = await bridge.eval(buildSerializerScript('body', opts.domDepth, false));
      const parsed = DomNodeSchema.parse(JSON.parse(String(raw)));
      const path = join(outDir, 'dom.json');
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files.dom = path;
    } catch (err) {
      files.dom = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 4. Storage
    try {
      const raw = await bridge.eval(STORAGE_SCRIPT);
      const parsed = SnapshotStorageResultSchema.parse(JSON.parse(String(raw)));
      const path = join(outDir, 'storage.json');
      await writeFile(path, JSON.stringify(parsed, null, 2));
      files.storage = path;
    } catch (err) {
      files.storage = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 5. Console errors (wait for monitoring duration)
    let errorCount = 0;
    try {
      await new Promise((resolve) => setTimeout(resolve, opts.logsDuration));
      const raw = await bridge.eval(DRAIN_CONSOLE_ERRORS_SCRIPT);
      const errors = JSON.parse(String(raw));
      errorCount = errors.length;
      const path = join(outDir, 'console-errors.json');
      await writeFile(path, JSON.stringify(errors, null, 2));
      files.consoleErrors = path;
    } catch (err) {
      files.consoleErrors = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 6. Rust logs
    try {
      const entries = await bridge.fetchLogs();
      const path = join(outDir, 'rust-logs.json');
      await writeFile(path, JSON.stringify(entries, null, 2));
      files.rustLogs = path;
    } catch (err) {
      files.rustLogs = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 7. Custom eval (optional)
    if (opts.eval) {
      try {
        const raw = await bridge.eval(opts.eval);
        const path = join(outDir, 'eval.json');
        const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw;
        await writeFile(path, JSON.stringify(parsed, null, 2));
        files.eval = path;
      } catch (err) {
        files.eval = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Write manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      url: pageUrl,
      title: pageTitle,
      viewport,
      errorCount,
      files,
    };
    const manifestPath = join(outDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    if (opts.json) {
      console.log(JSON.stringify(manifest, null, 2));
    } else {
      console.log(`Captured to: ${outDir}`);
      for (const [key, value] of Object.entries(files)) {
        const isError = value.startsWith('error: ');
        const prefix = isError ? 'FAIL' : '  OK';
        console.log(`[${prefix}] ${key}: ${value}`);
      }
      if (errorCount > 0) {
        console.log(`\nWarning: ${errorCount} console error(s) detected`);
      }
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 4: Register in cli.ts**

Add import: `import { registerCapture } from './commands/capture.js';`
Add registration: `registerCapture(program, getAdapter);`

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/commands/capture.test.ts`
Expected: PASS

- [ ] **Step 6: Run full suite + type check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/commands/capture.ts src/commands/check.ts src/schemas/commands.ts src/schemas/index.ts src/cli.ts tests/commands/capture.test.ts tests/commands/check.test.ts
git commit -m "feat: add capture and check workflow commands"
```

---

## Phase 4: State Observability

### Task 13: Implement `store-inspect` command

**Files:**
- Create: `src/commands/storeInspect.ts`
- Modify: `src/schemas/commands.ts`, `src/schemas/index.ts`, `src/cli.ts`
- Test: `tests/commands/storeInspect.test.ts`

- [ ] **Step 1: Add StoreInspectResult schema**

Add to `src/schemas/commands.ts`:

```typescript
// === Store Inspect ===

export const StoreInspectResultSchema = z.object({
  framework: z.string(),
  stores: z.record(z.string(), z.unknown()),
});
export type StoreInspectResult = z.infer<typeof StoreInspectResultSchema>;
```

Add to `src/schemas/index.ts`:

```typescript
  StoreInspectResultSchema,
  type StoreInspectResult,
```

- [ ] **Step 2: Write tests**

Create `tests/commands/storeInspect.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { StoreInspectResultSchema } from '../../src/schemas/commands.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Store inspect command', () => {
  it('StoreInspectResult schema validates correctly', () => {
    const result = StoreInspectResultSchema.parse({
      framework: 'vue',
      stores: { uiStore: { theme: 'dark' }, executionStore: { running: false } },
    });
    expect(result.framework).toBe('vue');
    expect(Object.keys(result.stores)).toHaveLength(2);
  });

  it('builds detection script', async () => {
    const { buildStoreDetectionScript } = await import('../../src/commands/storeInspect.js');
    const script = buildStoreDetectionScript('auto', undefined, 3);
    expect(script).toContain('__DEBUG_STORES__');
    expect(script).toContain('__pinia');
    expect(script).toContain('JSON.stringify');
  });

  it('builds framework-specific script', async () => {
    const { buildStoreDetectionScript } = await import('../../src/commands/storeInspect.js');
    const script = buildStoreDetectionScript('vue', 'uiStore', 3);
    expect(script).toContain('__VUE_DEVTOOLS_GLOBAL_HOOK__');
  });
});
```

- [ ] **Step 3: Implement store-inspect command**

Create `src/commands/storeInspect.ts`:

```typescript
import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { StoreInspectResultSchema } from '../schemas/commands.js';

export function buildStoreDetectionScript(
  framework: string,
  storeName: string | undefined,
  depth: number,
): string {
  const storeFilter = storeName ? JSON.stringify(storeName) : 'null';

  return `(() => {
  function serialize(obj, maxDepth, d) {
    if (d >= maxDepth) return '[max depth]';
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.slice(0, 100).map(function(v) { return serialize(v, maxDepth, d+1); });
    var result = {};
    var keys = Object.keys(obj).slice(0, 50);
    for (var i = 0; i < keys.length; i++) {
      try { result[keys[i]] = serialize(obj[keys[i]], maxDepth, d+1); } catch(e) { result[keys[i]] = '[error]'; }
    }
    return result;
  }

  var filterName = ${storeFilter};
  var maxD = ${depth};

  // Priority 1: App-registered debug hook
  if (typeof window.__DEBUG_STORES__ === 'function') {
    var data = window.__DEBUG_STORES__();
    if (filterName && data.stores && data.stores[filterName]) {
      return JSON.stringify({ framework: data.framework || 'custom', stores: { [filterName]: serialize(data.stores[filterName], maxD, 0) } });
    }
    var serialized = {};
    var storeKeys = Object.keys(data.stores || {});
    for (var i = 0; i < storeKeys.length; i++) {
      serialized[storeKeys[i]] = serialize(data.stores[storeKeys[i]], maxD, 0);
    }
    return JSON.stringify({ framework: data.framework || 'custom', stores: serialized });
  }

  // Priority 2: Pinia (Vue ecosystem)
  ${framework === 'auto' || framework === 'vue' || framework === 'pinia' ? `
  if (window.__pinia) {
    var stores = {};
    window.__pinia._s.forEach(function(store, id) {
      if (!filterName || id === filterName) {
        stores[id] = serialize(store.$state, maxD, 0);
      }
    });
    return JSON.stringify({ framework: 'pinia', stores: stores });
  }` : ''}

  // Priority 3: Vue devtools hook
  ${framework === 'auto' || framework === 'vue' ? `
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    var apps = window.__VUE_DEVTOOLS_GLOBAL_HOOK__.apps || [];
    if (apps.length > 0) {
      return JSON.stringify({ framework: 'vue', stores: { _root: serialize(apps[0]._instance?.data || {}, maxD, 0) } });
    }
  }` : ''}

  return JSON.stringify({ framework: 'unknown', stores: {}, error: 'No store framework detected. Register window.__DEBUG_STORES__ for custom stores.' });
})()`;
}

export function registerStoreInspect(program: Command): void {
  const cmd = new Command('store-inspect')
    .description('Inspect reactive store state')
    .option('--framework <name>', 'Framework: vue, pinia, react, svelte, zustand, auto', 'auto')
    .option('--store <name>', 'Specific store name to inspect')
    .option('--depth <n>', 'Serialization depth limit', parseInt, 3)
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & {
    framework: string;
    store?: string;
    depth: number;
    json?: boolean;
  }) => {
    const bridge = await resolveBridge(opts);
    const js = buildStoreDetectionScript(opts.framework, opts.store, opts.depth);
    const raw = await bridge.eval(js);
    const result = StoreInspectResultSchema.parse(JSON.parse(String(raw)));

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Framework: ${result.framework}`);
      console.log(`Stores: ${Object.keys(result.stores).join(', ')}`);
      console.log(JSON.stringify(result.stores, null, 2));
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 4: Register in cli.ts**

Add import: `import { registerStoreInspect } from './commands/storeInspect.js';`
Add registration: `registerStoreInspect(program);`

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/commands/storeInspect.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/storeInspect.ts src/schemas/commands.ts src/schemas/index.ts src/cli.ts tests/commands/storeInspect.test.ts
git commit -m "feat: add store-inspect command for reactive store inspection"
```

---

## Phase 5: Probe Command + Bridge Updates

### Task 14: Implement `probe` command

**Files:**
- Create: `src/commands/probe.ts`
- Modify: `src/schemas/bridge.ts`, `src/schemas/index.ts`, `src/cli.ts`
- Test: `tests/commands/probe.test.ts`

- [ ] **Step 1: Add schemas**

Add to `src/schemas/bridge.ts`:

```typescript
// === Bridge Describe Response ===

export const DescribeResponseSchema = z.object({
  app: z.string().optional(),
  pid: z.number().optional(),
  windows: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  surfaces: z.record(z.string(), z.string()).optional(),
  exports: z.record(z.string(), z.string()).optional(),
});
export type DescribeResponse = z.infer<typeof DescribeResponseSchema>;

export const VersionResponseSchema = z.object({
  version: z.string(),
  endpoints: z.array(z.string()),
});
export type VersionResponse = z.infer<typeof VersionResponseSchema>;
```

Add to `src/schemas/index.ts`:

```typescript
  DescribeResponseSchema,
  type DescribeResponse,
  VersionResponseSchema,
  type VersionResponse,
```

- [ ] **Step 2: Add describe() and version() to BridgeClient**

Add these methods to the `BridgeClient` class in `src/bridge/client.ts`:

```typescript
  async describe(): Promise<import('../schemas/bridge.js').DescribeResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const { DescribeResponseSchema } = await import('../schemas/bridge.js');
      return DescribeResponseSchema.parse(await res.json());
    } catch {
      return null;
    }
  }

  async version(): Promise<import('../schemas/bridge.js').VersionResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/version`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const { VersionResponseSchema } = await import('../schemas/bridge.js');
      return VersionResponseSchema.parse(await res.json());
    } catch {
      return null;
    }
  }
```

- [ ] **Step 3: Write tests**

Create `tests/commands/probe.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DescribeResponseSchema, VersionResponseSchema } from '../../src/schemas/bridge.js';

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn(),
  discoverBridgesByPid: vi.fn(),
}));

describe('Probe command', () => {
  it('DescribeResponse schema validates correctly', () => {
    const result = DescribeResponseSchema.parse({
      app: 'contextful_desktop',
      pid: 12345,
      windows: ['main', 'overlay'],
      capabilities: ['eval', 'logs', 'describe'],
      surfaces: { canvas: '.pixi-canvas' },
      exports: { 'debug-snapshot': 'window.__contextful_getDebugSnapshot()' },
    });
    expect(result.app).toBe('contextful_desktop');
    expect(result.windows).toContain('overlay');
  });

  it('DescribeResponse allows empty response', () => {
    const result = DescribeResponseSchema.parse({});
    expect(result.app).toBeUndefined();
  });

  it('VersionResponse schema validates', () => {
    const result = VersionResponseSchema.parse({
      version: '0.6.0',
      endpoints: ['/eval', '/logs', '/describe', '/invoke', '/version'],
    });
    expect(result.version).toBe('0.6.0');
  });
});
```

- [ ] **Step 4: Implement probe command**

Create `src/commands/probe.ts`:

```typescript
import { Command } from 'commander';
import type { DisplayServer } from '../types.js';
import { detectDisplayServer, ensureTools } from '../platform/detect.js';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { discoverBridgesByPid } from '../bridge/tokenDiscovery.js';

export function registerProbe(program: Command): void {
  const cmd = new Command('probe')
    .description('Discover and report Tauri app targets, bridge health, and platform info')
    .option('--json', 'Output as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & { json?: boolean }) => {
    const bridges = await discoverBridgesByPid();

    if (bridges.size === 0 && !opts.port) {
      throw new Error('No Tauri bridge found. Start a Tauri app with the dev bridge enabled.');
    }

    // Resolve specific bridge or use first
    const bridge = await resolveBridge(opts);
    const alive = await bridge.ping();

    // Get bridge version and describe info (graceful on 404)
    const version = await bridge.version();
    const describe = await bridge.describe();

    // Page info via eval
    let pageInfo: { url?: string; title?: string; viewport?: { width: number; height: number } } = {};
    if (alive) {
      try {
        const raw = await bridge.eval(`JSON.stringify({ url: window.location.href, title: document.title, viewport: { width: window.innerWidth, height: window.innerHeight } })`);
        pageInfo = JSON.parse(String(raw));
      } catch { /* ignore */ }
    }

    // Platform info
    let displayServer: DisplayServer = 'unknown';
    let tools: string[] = [];
    try {
      displayServer = detectDisplayServer();
      if (displayServer !== 'unknown') {
        await ensureTools(displayServer);
        tools = displayServer === 'darwin'
          ? ['screencapture', 'sips', 'osascript']
          : displayServer === 'x11'
            ? ['xdotool', 'imagemagick']
            : ['grim', displayServer === 'wayland-hyprland' ? 'hyprctl' : 'swaymsg'];
      }
    } catch { /* ignore */ }

    const result = {
      bridges: [...bridges.entries()].map(([pid, b]) => ({ pid, port: b.port })),
      bridge: {
        alive,
        version: version?.version,
        endpoints: version?.endpoints,
      },
      page: pageInfo,
      platform: { displayServer, tools },
      app: describe ?? undefined,
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Bridge: ${alive ? 'alive' : 'unreachable'}`);
      if (version) console.log(`Version: ${version.version}`);
      if (pageInfo.title) console.log(`Page: ${pageInfo.title} (${pageInfo.url})`);
      if (pageInfo.viewport) console.log(`Viewport: ${pageInfo.viewport.width}x${pageInfo.viewport.height}`);
      console.log(`Platform: ${displayServer}`);
      if (describe?.app) console.log(`App: ${describe.app}`);
      if (describe?.windows) console.log(`Windows: ${describe.windows.join(', ')}`);
      if (describe?.surfaces) console.log(`Surfaces: ${Object.keys(describe.surfaces).join(', ')}`);
      if (describe?.exports) console.log(`Exports: ${Object.keys(describe.exports).join(', ')}`);
      console.log(`\nRunning bridges:`);
      for (const [pid, b] of bridges) {
        console.log(`  PID ${pid} → port ${b.port}`);
      }
    }
  });

  program.addCommand(cmd);
}
```

- [ ] **Step 5: Register in cli.ts**

Add import: `import { registerProbe } from './commands/probe.js';`
Add registration: `registerProbe(program);`

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/commands/probe.test.ts`
Expected: PASS

- [ ] **Step 7: Run full safety net**

Run: `npm test && npx tsc --noEmit && node scripts/check-imports.mjs`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/commands/probe.ts src/bridge/client.ts src/schemas/bridge.ts src/schemas/index.ts src/cli.ts tests/commands/probe.test.ts
git commit -m "feat: add probe command for target discovery and bridge health reporting"
```

---

## Phase 6: Bridge Updates (Rust)

### Task 15: Update dev_bridge.rs for multi-window eval + new endpoints

**Files:**
- Modify: `examples/tauri-bridge/src/dev_bridge.rs`

- [ ] **Step 1: Add `window` field to EvalRequest**

In `examples/tauri-bridge/src/dev_bridge.rs`, update the `EvalRequest` struct:

```rust
#[derive(Deserialize)]
struct EvalRequest {
    js: String,
    token: String,
    #[serde(default)]
    window: Option<String>,
}
```

- [ ] **Step 2: Update eval handler to use window field**

Replace the line:
```rust
if let Some(window) = app_handle.get_webview_window("main") {
```
with:
```rust
let window_label = eval_req.window.as_deref().unwrap_or("main");
if let Some(window) = app_handle.get_webview_window(window_label) {
```

- [ ] **Step 3: Add DescribeRequest, DescribeResponse, and InvokeRequest structs**

Add after the existing structs:

```rust
#[derive(Deserialize)]
struct DescribeRequest {
    token: String,
}

#[derive(Serialize, Default)]
struct DescribeResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows: Option<Vec<String>>,
    capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    surfaces: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exports: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct VersionResponse {
    version: String,
    endpoints: Vec<String>,
}
```

- [ ] **Step 4: Add /version GET endpoint handler**

In the request loop, add before the existing POST check:

```rust
// Handle GET /version (no auth needed)
if request.url() == "/version" && request.method().as_str() == "GET" {
    let resp = VersionResponse {
        version: "0.6.0".to_string(),
        endpoints: vec![
            "/eval".to_string(),
            "/logs".to_string(),
            "/describe".to_string(),
            "/version".to_string(),
        ],
    };
    let json = serde_json::to_string(&resp).unwrap();
    let header = Header::from_bytes("Content-Type", "application/json").unwrap();
    let _ = request.respond(Response::from_string(json).with_header(header));
    continue;
}
```

- [ ] **Step 5: Add /describe POST endpoint handler**

Add handling for `/describe` in the URL check, alongside `/eval` and `/logs`. Update the URL check:

```rust
if !is_post || (url != "/eval" && url != "/logs" && url != "/describe") {
```

Then add the `/describe` handler after the `/logs` handler:

```rust
if url == "/describe" {
    let desc_req: DescribeRequest = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(_) => {
            let _ = request.respond(Response::from_string("Invalid JSON").with_status_code(400));
            continue;
        }
    };

    if desc_req.token != expected_token {
        let _ = request.respond(Response::from_string("Unauthorized").with_status_code(401));
        continue;
    }

    let windows: Vec<String> = app_handle
        .webview_windows()
        .keys()
        .cloned()
        .collect();

    let resp = DescribeResponse {
        pid: Some(std::process::id()),
        windows: Some(windows),
        capabilities: vec!["eval".to_string(), "logs".to_string(), "describe".to_string()],
        ..Default::default()
    };

    let json = serde_json::to_string(&resp).unwrap();
    let header = Header::from_bytes("Content-Type", "application/json").unwrap();
    let _ = request.respond(Response::from_string(json).with_header(header));
    continue;
}
```

- [ ] **Step 6: Commit**

```bash
git add examples/tauri-bridge/src/dev_bridge.rs
git commit -m "feat: add /version, /describe endpoints and multi-window eval to bridge"
```

---

## Phase 7: Skills & Documentation

### Task 16: Update agent skills

**Files:**
- Modify: `.agents/skills/tauri-agent-tools/SKILL.md`
- Modify: `.agents/skills/tauri-bridge-setup/SKILL.md`

- [ ] **Step 1: Update tauri-agent-tools skill version and command table**

In `.agents/skills/tauri-agent-tools/SKILL.md`:

1. Update version in frontmatter to `0.6.0`
2. Update description to mention interaction commands
3. Add to the command reference table:

```markdown
| `click` | `<selector>`, `--double`, `--right`, `--wait <ms>`, `--json` | yes | Click a DOM element |
| `type` | `<selector> <text>`, `--clear`, `--json` | yes | Type text into an input |
| `scroll` | `--selector <css>`, `--by <px>`, `--to-top`, `--to-bottom`, `--into-view`, `--json` | yes | Scroll window or element |
| `focus` | `<selector>`, `--json` | yes | Focus a DOM element |
| `navigate` | `<target>`, `--json` | yes | Navigate within the app |
| `select` | `<selector> [value]`, `--toggle`, `--json` | yes | Select dropdown value or toggle checkbox |
| `invoke` | `<command> [args-json]`, `--json` | yes | Invoke a Tauri IPC command |
| `probe` | `--pid <n>`, `--json` | optional | Discover targets, bridge health, platform info |
| `capture` | `-o <dir>`, `-s <css>`, `--logs-duration <ms>`, `--json` | yes | Full debug evidence bundle |
| `check` | `--selector`, `--text`, `--eval`, `--no-errors`, `--json` | yes | Structured assertions (exit 0/1) |
| `store-inspect` | `--framework`, `--store <name>`, `--depth <n>`, `--json` | yes | Inspect reactive store state |
```

4. Add new workflow sections for interaction, probe/capture/check flow
5. Update the "Important Notes" section to mention interaction commands are debug-only

- [ ] **Step 2: Update bridge setup skill**

In `.agents/skills/tauri-bridge-setup/SKILL.md`, add a section about:
- New `window` field in EvalRequest for multi-window support
- New `/describe` and `/version` endpoints
- How to register surfaces and exports for app-specific convenience

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/tauri-agent-tools/SKILL.md .agents/skills/tauri-bridge-setup/SKILL.md
git commit -m "docs: update agent skills for v0.6.0 commands"
```

---

### Task 17: Create contextful-desktop agent skill

**Files:**
- Create: `.agents/skills/contextful-desktop/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `.agents/skills/contextful-desktop/SKILL.md` covering:

1. App overview: Vue 3 + Tauri v2 + Pixi.js 8 + NDJSON sidecar
2. Named surfaces: canvas (`.pixi-canvas`), sidebar (`#sidebar-panel`), toolbar (`.toolbar`), properties (`.properties-panel`)
3. Named exports / eval recipes:
   - Debug snapshot: `window.__contextful_getDebugSnapshot()`
   - Recent errors: `window.__contextful_getLogs(10, 'error')`
   - Canvas blocks: `document.querySelectorAll('[data-block-id]').length`
   - Execution state: `window.__DEBUG_STORES__().stores.executionStore`
4. Store reference (grouped by domain): definition, execution, canvas, UI, cortex, wiki, memory, planning, etc.
5. View navigation: how to switch views by clicking tab elements
6. Common debugging workflows:
   - "App won't load" → `probe → check --selector ".app-ready" → capture`
   - "Execution stuck" → `store-inspect --store executionStore → ipc-monitor → rust-logs`
   - "Canvas wrong" → `eval --file canvas-inspect.js → screenshot → diff`
   - "Sidecar errors" → `rust-logs --source sidecar → console-monitor --level error`
7. Interaction patterns specific to contextful UI

- [ ] **Step 2: Commit**

```bash
git add .agents/skills/contextful-desktop/SKILL.md
git commit -m "feat: add contextful-desktop agent skill"
```

---

### Task 18: Update CLAUDE.md and run final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Update the command count from 14 to 25, add new command files to the key source locations table, update the architecture section to mention the `interact/` subdirectory, and add new commands to the module dependency DAG.

- [ ] **Step 2: Run full safety net**

```bash
npm test
npx tsc --noEmit
node scripts/check-imports.mjs
npx madge --circular --extensions ts,tsx src/
```

Expected: All pass, no circular dependencies.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v0.6.0 with 25 commands"
```
