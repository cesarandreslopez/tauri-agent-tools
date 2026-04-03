import { z } from 'zod';

// === Invoke Result ===

export const InvokeResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    command: z.string(),
    result: z.unknown(),
  }),
  z.object({
    success: z.literal(false),
    command: z.string(),
    error: z.string(),
  }),
]);
export type InvokeResult = z.infer<typeof InvokeResultSchema>;
