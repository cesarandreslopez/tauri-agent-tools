import { z } from 'zod';

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

export const DomNodeSchema: z.ZodType<DomNode> = z.object({
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  text: z.string().optional(),
  rect: z.object({ width: z.number(), height: z.number() }).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  styles: z.record(z.string(), z.string()).optional(),
  get children(): z.ZodOptional<z.ZodArray<z.ZodType<DomNode>>> {
    return z.array(DomNodeSchema).optional();
  },
});

// === Accessibility Tree ===

export interface A11yNode {
  role: string;
  name?: string;
  state?: Record<string, unknown>;
  children?: A11yNode[];
}

export const A11yNodeSchema: z.ZodType<A11yNode> = z.object({
  role: z.string(),
  name: z.string().optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  get children(): z.ZodOptional<z.ZodArray<z.ZodType<A11yNode>>> {
    return z.array(A11yNodeSchema).optional();
  },
});
