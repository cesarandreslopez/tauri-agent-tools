import { z } from 'zod';

// === Interaction Result ===

export const InteractionResultSchema = z.object({
  success: z.boolean(),
  selector: z.string().optional(),
  tagName: z.string().optional(),
  error: z.string().optional(),
});
export type InteractionResult = z.infer<typeof InteractionResultSchema>;

// === Scroll Result ===

export const ScrollResultSchema = z.object({
  success: z.boolean(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  error: z.string().optional(),
});
export type ScrollResult = z.infer<typeof ScrollResultSchema>;

// === Select Result ===

export const SelectResultSchema = z.object({
  success: z.boolean(),
  selector: z.string().optional(),
  tagName: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  error: z.string().optional(),
});
export type SelectResult = z.infer<typeof SelectResultSchema>;
