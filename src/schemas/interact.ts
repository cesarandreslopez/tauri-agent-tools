import { z } from 'zod';

// === Type Command Result ===

export const TypeResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    selector: z.string(),
    tagName: z.string(),
    value: z.string(),
  }),
  z.object({
    success: z.literal(false),
    selector: z.string(),
    error: z.string(),
  }),
]);
export type TypeResult = z.infer<typeof TypeResultSchema>;
