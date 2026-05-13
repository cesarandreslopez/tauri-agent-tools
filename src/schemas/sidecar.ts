import { z } from 'zod';

/**
 * One envelope emitted by `sidecar tap`. The raw line is preserved in
 * `payload` after JSON.parse if the line was parseable, otherwise it lives in
 * `rawLine`. `valid` reflects either schema conformance (when a schema is
 * supplied) or simple JSON-parse success.
 */
export const SidecarEnvelopeSchema = z.object({
  ts: z.string(),
  direction: z.enum(['sidecar→', '←parent']),
  valid: z.boolean(),
  payload: z.unknown().optional(),
  rawLine: z.string().optional(),
  parseError: z.string().optional(),
  schemaErrors: z.array(z.unknown()).optional(),
});
export type SidecarEnvelope = z.infer<typeof SidecarEnvelopeSchema>;
