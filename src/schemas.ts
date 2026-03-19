import { z } from 'zod';

// === Token Discovery ===

export const TokenFileSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
  pid: z.number().int().positive(),
});
export type TokenFile = z.infer<typeof TokenFileSchema>;

// === Bridge Types ===

export const ElementRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ElementRect = z.infer<typeof ElementRectSchema>;

export const BridgeConfigSchema = z.object({
  port: z.number(),
  token: z.string(),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

export const ViewportSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});
export type ViewportSize = z.infer<typeof ViewportSizeSchema>;

export const RustLogEntrySchema = z.object({
  timestamp: z.number(),
  level: z.string(),
  target: z.string(),
  message: z.string(),
  source: z.string(),
});
export type RustLogEntry = z.infer<typeof RustLogEntrySchema>;

// === DOM ===

export interface DomNode {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  rect?: { width: number; height: number };
  attributes?: Record<string, string>;
  styles?: Record<string, string>;
  children?: DomNode[];
}

export const DomNodeSchema: z.ZodType<DomNode> = z.lazy(() =>
  z.object({
    tag: z.string(),
    id: z.string().optional(),
    classes: z.array(z.string()).optional(),
    text: z.string().optional(),
    rect: z.object({ width: z.number(), height: z.number() }).optional(),
    attributes: z.record(z.string()).optional(),
    styles: z.record(z.string()).optional(),
    children: z.array(DomNodeSchema).optional(),
  }),
);

export interface A11yNode {
  role: string;
  name?: string;
  state?: Record<string, unknown>;
  children?: A11yNode[];
}

export const A11yNodeSchema: z.ZodType<A11yNode> = z.lazy(() =>
  z.object({
    role: z.string(),
    name: z.string().optional(),
    state: z.record(z.unknown()).optional(),
    children: z.array(A11yNodeSchema).optional(),
  }),
);

// === Storage ===

export const StorageEntrySchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
});
export type StorageEntry = z.infer<typeof StorageEntrySchema>;

// === Page State ===

export const PageStateSchema = z.object({
  url: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  scroll: z.object({ x: z.number(), y: z.number() }),
  document: z.object({ width: z.number(), height: z.number() }),
  hasTauri: z.boolean(),
});
export type PageState = z.infer<typeof PageStateSchema>;

// === Console Monitor ===

export const ConsoleEntrySchema = z.object({
  level: z.string(),
  message: z.string(),
  timestamp: z.number(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

// === Mutations ===

export const MutationEntrySchema = z.object({
  type: z.string(),
  target: z.string(),
  timestamp: z.number(),
  added: z.array(z.object({
    tag: z.string(),
    id: z.string().optional(),
    class: z.string().optional(),
  })).optional(),
  removed: z.array(z.object({
    tag: z.string(),
    id: z.string().optional(),
    class: z.string().optional(),
  })).optional(),
  attribute: z.string().optional(),
  oldValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
});
export type MutationEntry = z.infer<typeof MutationEntrySchema>;

// === IPC Monitor ===

export const IpcEntrySchema = z.object({
  command: z.string(),
  args: z.record(z.unknown()),
  timestamp: z.number(),
  duration: z.number().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type IpcEntry = z.infer<typeof IpcEntrySchema>;

// === Platform: macOS ===

export const CGWindowInfoSchema = z.object({
  kCGWindowNumber: z.number(),
  kCGWindowOwnerPID: z.number().optional(),
  kCGWindowName: z.string().optional(),
  kCGWindowOwnerName: z.string().optional(),
  kCGWindowBounds: z.object({
    X: z.number(),
    Y: z.number(),
    Width: z.number(),
    Height: z.number(),
  }),
});
export type CGWindowInfo = z.infer<typeof CGWindowInfoSchema>;

// === Platform: Wayland ===

export interface SwayNode {
  id: number;
  pid?: number;
  name: string | null;
  rect: { x: number; y: number; width: number; height: number };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

export const SwayNodeSchema: z.ZodType<SwayNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    pid: z.number().optional(),
    name: z.string().nullable(),
    rect: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    nodes: z.array(SwayNodeSchema).optional(),
    floating_nodes: z.array(SwayNodeSchema).optional(),
  }),
);
