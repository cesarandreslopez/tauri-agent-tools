import { z } from 'zod';

// === Click Result ===

export const ClickResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    selector: z.string(),
    tagName: z.string(),
    text: z.string(),
  }),
  z.object({
    success: z.literal(false),
    selector: z.string(),
    error: z.string(),
  }),
]);
export type ClickResult = z.infer<typeof ClickResultSchema>;
