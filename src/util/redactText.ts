import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const REDACTED = '[REDACTED]';

/**
 * Generated-artifact filenames that may legitimately look high-entropy
 * (timestamped report/capture names embedded in logs or markdown). Matches
 * are exempt from the residual-secret entropy gate. App-specific artifact
 * name patterns can be added per call via `scanResidualSecrets` opts.
 */
const DEFAULT_ARTIFACT_NAME_ALLOWLIST: RegExp[] = [
  /^\d{8}-\d{6}-[a-z0-9][a-z0-9.-]*\.(?:md|html|json|ndjson|jsonl)$/i,
];

/**
 * Agent-CLI config dirs masked as a pre-pass before the generic home-path
 * pattern (catches them even in contexts the tilde/absolute pattern misses).
 */
const AGENT_HOME_DIRS = ['.claude', '.codex'];

const TEXT_FILE_RE = /\.(json|ndjson|txt|md|log|html)$/i;
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const SECRET_KEY_RE = /token|secret|password|api[_-]?key|authorization|cookie|email|credential|(?:_key|_token|_secret|_password|_credential)$/i;

type RedactableJson =
  | string
  | number
  | boolean
  | null
  | RedactableJson[]
  | { [key: string]: RedactableJson };

interface RedactionResult<T> {
  value: T;
  redactions: number;
}

interface StructuredRedactionResult extends RedactionResult<string> {
  structured: boolean;
}

export type RedactDirIssueReason =
  | 'readdir_failed'
  | 'stat_failed'
  | 'read_failed'
  | 'write_failed'
  | 'image_unredacted';

export interface RedactDirIssue {
  path: string;
  reason: RedactDirIssueReason;
  message?: string;
}

export interface RedactDirResult {
  redactions: number;
  failures: RedactDirIssue[];
  warnings: RedactDirIssue[];
}

export interface ResidualSecretHit {
  path: string;
  prefix: string;
  offset: number;
  sample: string;
}

type TextReplacement = string | ((match: string, ...groups: string[]) => string);

const TEXT_PATTERNS: Array<{ re: RegExp; replacement: TextReplacement }> = [
  {
    re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: REDACTED,
  },
  {
    re: /([?&](?:token|api[_-]?key|secret|password|authorization)=)[^&\s"'<>]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    re: /(^|[^A-Za-z0-9])((?:(?:[A-Za-z0-9]+_)*(?:API_KEY|ACCESS_KEY|SECRET_ACCESS_KEY|KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)|token|api[_-]?key|secret|password|cookie)\s*[:=]\s*)["']?[^"',\s<>&]+["']?/gi,
    replacement: (_match, prefix, key) => `${prefix}${key}${REDACTED}`,
  },
  {
    re: /(["'](?:[^"']*(?:token|api[_-]?key|secret|password|authorization|cookie|credential|email)[^"']*)["']\s*:\s*")[^"]*(")/gi,
    replacement: '$1[REDACTED]$2',
  },
  {
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[REDACTED_AWS_ACCESS_KEY]',
  },
  {
    re: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g,
    replacement: '[REDACTED_IP]',
  },
  {
    // HH:MM:SS clock times (incl. inside ISO-8601 timestamps) share the
    // colon-group shape, so only redact candidates that look like real IPv6:
    // a `::`, a hex letter, or a group longer than 2 digits.
    re: /(?<![A-F0-9:])(?:[A-F0-9]{1,4}:){2,7}:?(?:[A-F0-9]{1,4})?(?![A-F0-9:])/gi,
    replacement: (match) =>
      match.includes('::') || /[a-f]/i.test(match) || match.split(':').some((group) => group.length > 2)
        ? '[REDACTED_IP]'
        : match,
  },
  {
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    re: /(?<!\d)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/g,
    replacement: '[REDACTED_PHONE]',
  },
  {
    // A tilde only counts as a home path when it starts one (`~/...`) —
    // bare `~` is common in prose ("~10s", "~~strikethrough~~").
    re: /(?:~(?=\/)|\/Users\/[^/\s"'<>]+|\/home\/[^/\s"'<>]+)(?:\/[^\s"'<>]*)?/g,
    replacement: '[HOME]',
  },
];

const RESIDUAL_SECRET_PATTERNS: Array<{ prefix: string; re: RegExp }> = [
  { prefix: 'sk-ant-', re: /sk-ant-[A-Za-z0-9_-]{12,}/g },
  { prefix: 'sk-', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { prefix: 'ghp_', re: /ghp_[A-Za-z0-9_]{16,}/g },
  { prefix: 'xoxb-', re: /xoxb-[A-Za-z0-9-]{16,}/g },
  { prefix: 'AKIA', re: /AKIA[A-Z0-9]{16}/g },
  { prefix: 'ASIA', re: /ASIA[A-Z0-9]{16}/g },
  { prefix: 'Authorization:', re: /Authorization:\s*(?:Bearer\s+)?[A-Za-z0-9._~+/-]{8,}=*/gi },
];

export function redactText(input: string): string {
  return redactTextWithStats(input).value;
}

export function redactJson(value: unknown): unknown {
  return redactJsonWithStats(value).value;
}

export async function redactDir(dir: string): Promise<RedactDirResult> {
  const result: RedactDirResult = { redactions: 0, failures: [], warnings: [] };
  const entries = await readdir(dir).catch((error: unknown) => {
    result.warnings.push({ path: dir, reason: 'readdir_failed', message: errorMessage(error) });
    return null;
  });
  if (entries == null) return result;

  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full).catch((error: unknown) => {
      result.warnings.push({ path: full, reason: 'stat_failed', message: errorMessage(error) });
      return null;
    });
    if (!st) continue;
    if (st.isDirectory()) {
      mergeRedactDirResult(result, await redactDir(full));
      continue;
    }
    if (!TEXT_FILE_RE.test(name)) {
      if (IMAGE_FILE_RE.test(name)) {
        result.warnings.push({ path: full, reason: 'image_unredacted' });
      }
      continue;
    }

    const original = await readFile(full, 'utf-8').catch((error: unknown) => {
      result.warnings.push({ path: full, reason: 'read_failed', message: errorMessage(error) });
      return null;
    });
    if (original == null) continue;

    const structured = redactStructuredText(original, name);
    const redacted = structured.structured
      ? { value: structured.value, redactions: 0 }
      : redactTextWithStats(structured.value);
    const next = redacted.value;
    const redactionCount = structured.redactions + redacted.redactions;

    if (next !== original) {
      try {
        await writeFile(full, next, 'utf-8');
        result.redactions += redactionCount;
      } catch (error) {
        result.failures.push({ path: full, reason: 'write_failed', message: errorMessage(error) });
      }
    }
  }
  return result;
}

export function scanResidualSecrets(
  input: string,
  path: string,
  opts: { allowNames?: RegExp[] } = {},
): ResidualSecretHit[] {
  const allowNames = [...DEFAULT_ARTIFACT_NAME_ALLOWLIST, ...(opts.allowNames ?? [])];
  const hits: ResidualSecretHit[] = [];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const { prefix, re } of RESIDUAL_SECRET_PATTERNS) {
    for (const match of input.matchAll(re)) {
      const value = match[0];
      const offset = match.index ?? 0;
      if (ranges.some((range) => offset < range.end && offset + value.length > range.start)) continue;
      hits.push({
        path,
        prefix,
        offset,
        sample: sampleSecret(value),
      });
      ranges.push({ start: offset, end: offset + value.length });
    }
  }

  for (const match of input.matchAll(/[A-Za-z0-9+_=.-]{40,}/g)) {
    const value = match[0];
    const offset = match.index ?? 0;
    if (ranges.some((range) => offset < range.end && offset + value.length > range.start)) continue;
    if (allowNames.some((re) => re.test(value))) continue;
    if (!looksHighEntropy(value)) continue;
    hits.push({
      path,
      prefix: 'high-entropy',
      offset,
      sample: sampleSecret(value),
    });
  }

  return hits.sort((a, b) => a.offset - b.offset || a.prefix.localeCompare(b.prefix));
}

function redactStructuredText(content: string, name: string): StructuredRedactionResult {
  if (/\.json$/i.test(name)) {
    try {
      const parsed = JSON.parse(content) as unknown;
      const redacted = redactJsonWithStats(parsed);
      return {
        value: JSON.stringify(redacted.value),
        redactions: redacted.redactions,
        structured: true,
      };
    } catch {
      return { value: content, redactions: 0, structured: false };
    }
  }

  if (/\.ndjson$/i.test(name)) {
    let redactions = 0;
    const hadTrailingNewline = content.endsWith('\n');
    const lines = content
      .split(/\r?\n/)
      .filter((line, index, all) => line !== '' || index < all.length - 1)
      .map((line) => {
        if (line.trim() === '') return line;
        try {
          const parsed = JSON.parse(line) as unknown;
          const redacted = redactJsonWithStats(parsed);
          redactions += redacted.redactions;
          return JSON.stringify(redacted.value);
        } catch {
          const redacted = redactTextWithStats(line);
          redactions += redacted.redactions;
          return redacted.value;
        }
      });
    return {
      value: `${lines.join('\n')}${hadTrailingNewline ? '\n' : ''}`,
      redactions,
      structured: true,
    };
  }

  return { value: content, redactions: 0, structured: false };
}

function redactTextWithStats(input: string): RedactionResult<string> {
  let value = maskKnownHomePath(input);
  let redactions = value === input ? 0 : 1;
  const encoded = maskBase64HomePaths(value);
  value = encoded.value;
  redactions += encoded.redactions;

  for (const { re, replacement } of TEXT_PATTERNS) {
    const result = replaceAndCount(value, re, replacement);
    value = result.value;
    redactions += result.redactions;
  }

  return { value, redactions };
}

function replaceAndCount(input: string, re: RegExp, replacement: TextReplacement): RedactionResult<string> {
  if (typeof replacement === 'string') {
    const matches = Array.from(input.matchAll(re));
    if (matches.length === 0) return { value: input, redactions: 0 };
    return { value: input.replace(re, replacement), redactions: matches.length };
  }

  // Function replacements may decline a match (return it unchanged); only
  // count the ones that actually redacted something.
  let redactions = 0;
  const value = input.replace(re, (match: string, ...groups: string[]) => {
    const replaced = replacement(match, ...groups);
    if (replaced !== match) redactions += 1;
    return replaced;
  });
  return { value, redactions };
}

function mergeRedactDirResult(target: RedactDirResult, source: RedactDirResult): void {
  target.redactions += source.redactions;
  target.failures.push(...source.failures);
  target.warnings.push(...source.warnings);
}

function redactJsonWithStats(value: unknown): RedactionResult<unknown> {
  if (typeof value === 'string') {
    return redactTextWithStats(value);
  }

  if (Array.isArray(value)) {
    let redactions = 0;
    const items = value.map((item) => {
      const redacted = redactJsonWithStats(item);
      redactions += redacted.redactions;
      return redacted.value;
    });
    return { value: items, redactions };
  }

  if (isRecord(value)) {
    let redactions = 0;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) {
        const masked = maskJsonValue(child);
        redactions += masked.redactions;
        next[key] = masked.value;
      } else {
        const redacted = redactJsonWithStats(child);
        redactions += redacted.redactions;
        next[key] = redacted.value;
      }
    }
    return { value: next, redactions };
  }

  return { value, redactions: 0 };
}

function maskJsonValue(value: unknown): RedactionResult<RedactableJson> {
  if (Array.isArray(value)) {
    let redactions = 0;
    const items = value.map((item) => {
      const masked = maskJsonValue(item);
      redactions += masked.redactions;
      return masked.value;
    });
    return { value: items, redactions };
  }

  if (isRecord(value)) {
    let redactions = 0;
    const next: Record<string, RedactableJson> = {};
    for (const [key, child] of Object.entries(value)) {
      const masked = maskJsonValue(child);
      redactions += masked.redactions;
      next[key] = masked.value;
    }
    return { value: next, redactions };
  }

  return { value: REDACTED, redactions: 1 };
}

function maskKnownHomePath(input: string): string {
  const home = homedir();
  if (!home) return input;
  let value = input;
  for (const dir of AGENT_HOME_DIRS) {
    value = value.split(`${home}/${dir}`).join('[HOME]');
  }
  return value;
}

function maskBase64HomePaths(input: string): RedactionResult<string> {
  let redactions = 0;
  const value = input.replace(/\b(?:L1VzZXJz|L2hvbWU)[A-Za-z0-9+_=-]{20,}\b/g, (candidate) => {
    const decoded = decodeBase64Candidate(candidate);
    if (decoded == null) return candidate;
    if (!/^(?:\/Users\/|\/home\/|~\/)/.test(decoded)) return candidate;
    redactions += 1;
    return '[REDACTED_BASE64_PATH]';
  });
  return { value, redactions };
}

function decodeBase64Candidate(candidate: string): string | null {
  const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  try {
    const decoded = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf-8');
    return decoded.includes('\uFFFD') ? null : decoded;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sampleSecret(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function looksHighEntropy(value: string): boolean {
  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[+/=_-]/.test(value),
  ].filter(Boolean).length;
  if (classes < 3) return false;
  return shannonEntropy(value) >= 4.3;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
