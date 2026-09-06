import { z } from 'zod';
import type { BridgeClient } from './client.js';
import { CliError } from '../errors.js';

const EvaluationSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown(), truthy: z.boolean() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/** Keep evaluation errors distinct from strings beginning with "ERROR:".
 * The envelope is JSON text, so it works with both legacy stringifying bridges
 * and bridges that preserve native JSON values. Truthiness is computed before
 * serialization ("false" and false must remain different).
 */
export function buildEvaluationScript(expression: string): string {
  return `(async () => {
    try {
      const value = await (0, eval)(${JSON.stringify(expression)});
      const kind = typeof value;
      const encoded = kind === 'undefined' ? null
        : ['bigint', 'symbol', 'function'].includes(kind) || (kind === 'number' && !Number.isFinite(value))
          ? String(value) : value;
      return JSON.stringify({ ok: true, value: encoded, truthy: !!value });
    } catch (error) {
      return JSON.stringify({ ok: false, error: error && error.message ? String(error.message) : String(error) });
    }
  })()`;
}

export async function evaluateExpression(
  bridge: Pick<BridgeClient, 'eval'>,
  expression: string,
  timeout = 5000,
): Promise<{ value: unknown; truthy: boolean }> {
  const raw = await bridge.eval(buildEvaluationScript(expression), timeout);
  const result = EvaluationSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  if (!result.ok) throw new CliError('EVAL_FAILED', result.error, 'Check the expression or selector in the selected webview.');
  return { value: result.value, truthy: result.truthy };
}
