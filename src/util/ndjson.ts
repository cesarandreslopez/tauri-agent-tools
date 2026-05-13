import { createRequire } from 'node:module';
import type { ErrorObject, Options as AjvOptions, ValidateFunction } from 'ajv';

// Ajv v8 + ajv-formats are CJS packages; their constructor/function lives on `.default`
// under Node's strict ESM resolution. Using createRequire gives a clean CJS import
// without fighting TypeScript's namespace-import semantics.
const require_ = createRequire(import.meta.url);
type AjvInstance = {
  compile: (schema: unknown) => ValidateFunction;
  // Other Ajv methods exist but aren't used here; keeping the surface minimal.
};
type AjvCtor = new (opts?: AjvOptions) => AjvInstance;
const ajvLoaded = require_('ajv') as { default?: AjvCtor } | AjvCtor;
const Ajv: AjvCtor =
  typeof ajvLoaded === 'function'
    ? ajvLoaded
    : (ajvLoaded.default as AjvCtor);
const addFormatsLoaded = require_('ajv-formats') as
  | { default?: (ajv: AjvInstance) => void }
  | ((ajv: AjvInstance) => void);
const addFormats: (ajv: AjvInstance) => void =
  typeof addFormatsLoaded === 'function' ? addFormatsLoaded : (addFormatsLoaded.default as (ajv: AjvInstance) => void);

/**
 * Frame a stream of (potentially chunked) byte input into discrete lines,
 * tolerating both `\n` and `\r\n` separators. Splits on `\n`, strips a trailing
 * `\r`, holds incomplete trailing data until the next chunk or `flush()`.
 *
 * Lines are yielded individually (including blank ones; the caller decides
 * whether to skip them) so a downstream NDJSON parser sees exactly one envelope
 * per call.
 */
export class LineFramer {
  private buffer = '';

  push(chunk: string | Buffer): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, idx);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      out.push(line);
      this.buffer = this.buffer.slice(idx + 1);
    }
    return out;
  }

  /** Drain any unterminated trailing data (e.g., final line without newline). */
  flush(): string | null {
    if (this.buffer.length === 0) return null;
    const remainder = this.buffer.endsWith('\r')
      ? this.buffer.slice(0, -1)
      : this.buffer;
    this.buffer = '';
    return remainder;
  }
}

/**
 * Result of attempting to parse one NDJSON line. Distinguishes parse failures
 * (malformed JSON) from validation failures (schema mismatch) so consumers can
 * report each differently.
 */
export type NdjsonParseResult =
  | { ok: true; value: unknown; valid: boolean; errors: ErrorObject[] }
  | { ok: false; error: string };

export class NdjsonValidator {
  private validate: ValidateFunction | null;

  constructor(jsonSchema?: unknown) {
    if (jsonSchema === undefined || jsonSchema === null) {
      this.validate = null;
      return;
    }
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    this.validate = ajv.compile(jsonSchema as object);
  }

  /** Parse one line of JSON. If a schema was provided, validate against it. */
  parse(line: string): NdjsonParseResult {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!this.validate) {
      return { ok: true, value, valid: true, errors: [] };
    }

    const valid = this.validate(value);
    return {
      ok: true,
      value,
      valid: !!valid,
      errors: this.validate.errors ?? [],
    };
  }

  hasSchema(): boolean {
    return this.validate !== null;
  }
}
