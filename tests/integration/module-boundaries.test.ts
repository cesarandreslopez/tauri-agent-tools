/**
 * Integration tests verifying cross-module boundaries after the schemas/ extraction.
 *
 * These tests import from the NEW module paths (not re-export shims) and confirm
 * that module composition works end-to-end.
 */

import { z } from 'zod';

// --- Schema domain imports (leaf layer) ---
import {
  TokenFileSchema,
  BridgeConfigSchema,
  ElementRectSchema,
  ViewportSizeSchema,
  RustLogLevelSchema,
  RustLogEntrySchema,
  BridgeEvalResponseSchema,
  BridgeLogsResponseSchema,
} from '../../src/schemas/bridge.js';

import {
  DomNodeSchema,
  A11yNodeSchema,
} from '../../src/schemas/dom.js';

import {
  ImageFormatSchema,
  StorageEntrySchema,
  PageStateSchema,
  ConsoleLevelSchema,
  ConsoleEntrySchema,
  MutationTypeSchema,
  MutationEntrySchema,
  IpcEntrySchema,
  SnapshotStorageResultSchema,
  StorageTypeSchema,
  DomModeSchema,
  PackageJsonSchema,
} from '../../src/schemas/commands.js';

import {
  WindowIdSchema,
  CGWindowInfoSchema,
  SwayNodeSchema,
} from '../../src/schemas/platform.js';

// --- Barrel re-exports (all-in-one) ---
import * as barrel from '../../src/schemas/index.js';

// --- types.ts (pure interfaces layer, imports from schemas/) ---
import type {
  WindowInfo,
  PlatformAdapter,
  DisplayServer,
  WindowListEntry,
} from '../../src/types.js';

// --- Bridge module (uses schemas/ and types.ts) ---
import { BridgeClient } from '../../src/bridge/client.js';

// --- Utility module (uses schemas/ and types.ts) ---
import { computeCropRect } from '../../src/util/image.js';
import { validateWindowId } from '../../src/util/exec.js';

// --- Platform module (uses schemas/, types.ts, util/) ---
import { detectDisplayServer } from '../../src/platform/detect.js';

// --- Commands module (uses bridge/, schemas/, types.ts, util/) ---
import { addBridgeOptions, resolveBridge } from '../../src/commands/shared.js';

describe('Schema barrel completeness', () => {
  it('barrel re-exports all bridge schemas', () => {
    expect(barrel.TokenFileSchema).toBe(TokenFileSchema);
    expect(barrel.BridgeConfigSchema).toBe(BridgeConfigSchema);
    expect(barrel.ElementRectSchema).toBe(ElementRectSchema);
    expect(barrel.ViewportSizeSchema).toBe(ViewportSizeSchema);
    expect(barrel.RustLogLevelSchema).toBe(RustLogLevelSchema);
    expect(barrel.RustLogEntrySchema).toBe(RustLogEntrySchema);
    expect(barrel.BridgeEvalResponseSchema).toBe(BridgeEvalResponseSchema);
    expect(barrel.BridgeLogsResponseSchema).toBe(BridgeLogsResponseSchema);
  });

  it('barrel re-exports all dom schemas', () => {
    expect(barrel.DomNodeSchema).toBe(DomNodeSchema);
    expect(barrel.A11yNodeSchema).toBe(A11yNodeSchema);
  });

  it('barrel re-exports all command schemas', () => {
    expect(barrel.ImageFormatSchema).toBe(ImageFormatSchema);
    expect(barrel.StorageEntrySchema).toBe(StorageEntrySchema);
    expect(barrel.PageStateSchema).toBe(PageStateSchema);
    expect(barrel.ConsoleLevelSchema).toBe(ConsoleLevelSchema);
    expect(barrel.ConsoleEntrySchema).toBe(ConsoleEntrySchema);
    expect(barrel.MutationTypeSchema).toBe(MutationTypeSchema);
    expect(barrel.MutationEntrySchema).toBe(MutationEntrySchema);
    expect(barrel.IpcEntrySchema).toBe(IpcEntrySchema);
    expect(barrel.SnapshotStorageResultSchema).toBe(SnapshotStorageResultSchema);
    expect(barrel.StorageTypeSchema).toBe(StorageTypeSchema);
    expect(barrel.DomModeSchema).toBe(DomModeSchema);
    expect(barrel.PackageJsonSchema).toBe(PackageJsonSchema);
  });

  it('barrel re-exports all platform schemas', () => {
    expect(barrel.WindowIdSchema).toBe(WindowIdSchema);
    expect(barrel.CGWindowInfoSchema).toBe(CGWindowInfoSchema);
    expect(barrel.SwayNodeSchema).toBe(SwayNodeSchema);
  });
});

describe('Cross-module type compatibility', () => {
  it('types.ts ImageFormat aligns with schemas/commands.ts', () => {
    // ImageFormat is used in PlatformAdapter.captureWindow()
    const format = ImageFormatSchema.parse('png');
    expect(format).toBe('png');
    expect(ImageFormatSchema.safeParse('bmp').success).toBe(false);
  });

  it('types.ts BridgeConfig aligns with schemas/bridge.ts', () => {
    // BridgeConfig is used in WindowListEntry.bridge
    const config = BridgeConfigSchema.parse({ port: 3000, token: 'abc' });
    expect(config.port).toBe(3000);
    expect(config.token).toBe('abc');
  });

  it('WindowInfo shape is compatible with platform adapter outputs', () => {
    const info: WindowInfo = {
      windowId: '12345',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      name: 'Test Window',
    };
    expect(info.windowId).toBe('12345');
  });

  it('WindowListEntry extends WindowInfo with bridge config', () => {
    const entry: WindowListEntry = {
      windowId: '12345',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      tauri: true,
      bridge: { port: 3000, token: 'secret' },
    };
    // BridgeConfig from schemas/bridge.ts is assignable to the bridge field
    expect(BridgeConfigSchema.parse(entry.bridge!)).toEqual(entry.bridge);
  });
});

describe('Bridge module uses schemas correctly', () => {
  it('BridgeClient can be constructed from a BridgeConfig', () => {
    const config = BridgeConfigSchema.parse({ port: 9999, token: 'test-token' });
    const client = new BridgeClient(config);
    expect(client).toBeDefined();
  });

  it('ElementRect schema validates bridge getElementRect output', () => {
    const rect = ElementRectSchema.parse({ x: 10, y: 20, width: 100, height: 50 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('RustLogEntry schema validates bridge fetchLogs output', () => {
    const entry = RustLogEntrySchema.parse({
      timestamp: Date.now(),
      level: 'info',
      target: 'my_app',
      message: 'started',
      source: 'app',
    });
    expect(entry.level).toBe('info');
  });
});

describe('Util module uses schemas correctly', () => {
  it('computeCropRect produces valid geometry', () => {
    const result = computeCropRect(
      { x: 10, y: 20, width: 200, height: 100 },      // elementRect
      { width: 800, height: 600 },                      // viewport
      { width: 820, height: 640 },                      // windowGeometry (includes decorations)
    );
    // decorX = 820 - 800 = 20, decorY = 640 - 600 = 40
    expect(result.x).toBe(30);   // 20 + 10
    expect(result.y).toBe(60);   // 40 + 20
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('validateWindowId accepts valid IDs (uses WindowIdSchema pattern)', () => {
    expect(() => validateWindowId('12345')).not.toThrow();
  });

  it('validateWindowId rejects invalid IDs', () => {
    expect(() => validateWindowId('abc')).toThrow();
    expect(() => validateWindowId('')).toThrow();
  });
});

describe('Platform module detection', () => {
  it('detectDisplayServer returns a valid DisplayServer value', () => {
    const ds = detectDisplayServer();
    const validValues: DisplayServer[] = ['x11', 'wayland', 'wayland-sway', 'wayland-hyprland', 'darwin', 'unknown'];
    expect(validValues).toContain(ds);
  });
});

describe('Commands module composes bridge and schemas', () => {
  it('addBridgeOptions adds --port and --token to a command', async () => {
    const { Command } = await import('commander');
    const cmd = new Command('test-cmd');
    const result = addBridgeOptions(cmd);
    // The returned command should have port and token options
    const portOpt = result.options.find(o => o.long === '--port');
    const tokenOpt = result.options.find(o => o.long === '--token');
    expect(portOpt).toBeDefined();
    expect(tokenOpt).toBeDefined();
  });

  it('resolveBridge constructs client from explicit port+token (skips discovery)', async () => {
    const client = await resolveBridge({ port: 9999, token: 'test' });
    expect(client).toBeInstanceOf(BridgeClient);
  });
});

describe('CLI entry point composability', () => {
  it('PackageJsonSchema validates the real package.json', async () => {
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');

    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const raw = readFileSync(resolve(root, 'package.json'), 'utf-8');
    const pkg = PackageJsonSchema.parse(JSON.parse(raw));
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('all schema domain files export only Zod schemas (no stale re-exports)', () => {
    // Every export from domain files should be a ZodType or a type (which doesn't exist at runtime)
    const bridgeExports = Object.keys(barrel).filter(k => k.includes('Bridge') || k.includes('Token') || k.includes('Element') || k.includes('Viewport') || k.includes('RustLog'));
    expect(bridgeExports.length).toBeGreaterThan(0);

    // Verify they are Zod schemas
    for (const key of bridgeExports) {
      const val = (barrel as Record<string, unknown>)[key];
      if (val !== undefined) {
        expect(val).toHaveProperty('parse');
      }
    }
  });
});

describe('Recursive schema cross-module usage', () => {
  it('DomNode schema works with nested children (used by commands/dom.ts)', () => {
    const tree = DomNodeSchema.parse({
      tag: 'div',
      children: [
        { tag: 'span', text: 'hello' },
        { tag: 'ul', children: [{ tag: 'li', text: 'item' }] },
      ],
    });
    expect(tree.children).toHaveLength(2);
    expect(tree.children![1].children).toHaveLength(1);
  });

  it('A11yNode schema works with nested children (used by bridge/client.ts)', () => {
    const tree = A11yNodeSchema.parse({
      role: 'main',
      children: [
        { role: 'button', name: 'Submit' },
        { role: 'list', children: [{ role: 'listitem', name: 'Item 1' }] },
      ],
    });
    expect(tree.children).toHaveLength(2);
  });

  it('SwayNode schema works with nested nodes (used by platform/wayland.ts)', () => {
    const tree = SwayNodeSchema.parse({
      id: 1,
      name: 'root',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      nodes: [
        {
          id: 2,
          name: 'workspace',
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
          floating_nodes: [
            { id: 3, name: 'float', rect: { x: 100, y: 100, width: 200, height: 200 } },
          ],
        },
      ],
    });
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes![0].floating_nodes).toHaveLength(1);
  });
});
