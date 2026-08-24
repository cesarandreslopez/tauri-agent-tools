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

/**
 * Outcome of the post-write re-read performed by `type` and `select`:
 * - `matched`: the element still reports the value the setter applied.
 * - `transformed`: the app replaced it with a different value (mask, formatter) — a soft success.
 * - `reverted`: the element reads its pre-write value again — the app rejected the write (failure).
 */
export const WriteVerificationSchema = z.enum(['matched', 'transformed', 'reverted']);
export type WriteVerification = z.infer<typeof WriteVerificationSchema>;

/** Optional-only fields shared by the value-writing commands. */
const WriteResultFields = {
  /** The value as requested on the command line. */
  requestedValue: z.string().optional(),
  /** `el.value` before the write. */
  previousValue: z.string().optional(),
  /** True when the re-read equals the value the setter applied. */
  verified: z.boolean().optional(),
  verification: WriteVerificationSchema.optional(),
  /** Available `<option>` values when a `<select>` had no match. */
  options: z.array(z.string()).optional(),
  /** Actionable guidance accompanying a failure. */
  hint: z.string().optional(),
};

export const TypeResultSchema = InteractionResultSchema.extend({
  value: z.string().optional(),
  ...WriteResultFields,
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
  /** `checked` before a `--toggle`. */
  previousChecked: z.boolean().optional(),
  ...WriteResultFields,
});
export type SelectResult = z.infer<typeof SelectResultSchema>;

export const InvokeResultSchema = z.object({
  success: z.boolean(),
  command: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type InvokeResult = z.infer<typeof InvokeResultSchema>;
