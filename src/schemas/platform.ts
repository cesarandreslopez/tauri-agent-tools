import { z } from 'zod';

// === Platform: Window ID ===

export const WindowIdSchema = z.string().regex(/^\d+$/, 'Invalid window ID');

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

// === Platform: Wayland / Sway ===

export interface SwayNode {
  id: number;
  pid?: number;
  name: string | null;
  rect: { x: number; y: number; width: number; height: number };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

export const SwayNodeSchema: z.ZodType<SwayNode> = z.object({
  id: z.number(),
  pid: z.number().optional(),
  name: z.string().nullable(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  get nodes(): z.ZodOptional<z.ZodArray<z.ZodType<SwayNode>>> {
    return z.array(SwayNodeSchema).optional();
  },
  get floating_nodes(): z.ZodOptional<z.ZodArray<z.ZodType<SwayNode>>> {
    return z.array(SwayNodeSchema).optional();
  },
});

// === Platform: Wayland / Hyprland ===

export const HyprClientSchema = z.object({
  address: z.string(),
  mapped: z.boolean(),
  hidden: z.boolean(),
  at: z.tuple([z.number(), z.number()]),
  size: z.tuple([z.number(), z.number()]),
  workspace: z.object({
    id: z.number(),
    name: z.string(),
  }),
  floating: z.boolean(),
  monitor: z.number(),
  class: z.string(),
  title: z.string(),
  initialClass: z.string(),
  initialTitle: z.string(),
  pid: z.number(),
  xwayland: z.boolean(),
  pinned: z.boolean(),
  fullscreen: z.number(),
  grouped: z.array(z.string()),
  tags: z.array(z.string()),
  swallowing: z.string(),
  focusHistoryID: z.number(),
});
export type HyprClient = z.infer<typeof HyprClientSchema>;

export const HyprClientListSchema = z.array(HyprClientSchema);
