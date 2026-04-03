import { z } from 'zod';

// === Interaction Results ===

export const InteractionResultSchema = z.object({
  success: z.boolean(),
  selector: z.string().optional(),
  tagName: z.string().optional(),
  error: z.string().optional(),
});
export type InteractionResult = z.infer<typeof InteractionResultSchema>;

export const ClickResultSchema = InteractionResultSchema.extend({
  text: z.string().optional(),
});
export type ClickResult = z.infer<typeof ClickResultSchema>;

export const TypeResultSchema = InteractionResultSchema.extend({
  value: z.string().optional(),
});
export type TypeResult = z.infer<typeof TypeResultSchema>;

export const ScrollResultSchema = z.object({
  success: z.boolean(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  error: z.string().optional(),
});
export type ScrollResult = z.infer<typeof ScrollResultSchema>;

export const SelectResultSchema = InteractionResultSchema.extend({
  value: z.string().optional(),
  checked: z.boolean().optional(),
});
export type SelectResult = z.infer<typeof SelectResultSchema>;

export const InvokeResultSchema = z.object({
  success: z.boolean(),
  command: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type InvokeResult = z.infer<typeof InvokeResultSchema>;
