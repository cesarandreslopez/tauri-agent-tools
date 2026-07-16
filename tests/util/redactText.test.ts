import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactDir, redactJson, redactText, scanResidualSecrets } from '../../src/util/redactText.js';

describe('redactText', () => {
  it('masks secrets, PII, and home-rooted auth paths in plain text', () => {
    const raw = [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
      'callback http://localhost:1420/?token=abc.def-123',
      'email cesar@example.com and phone +1 (415) 555-0199',
      'read /Users/cesar/.claude/.credentials.json and ~/.codex/auth.json',
      '"api_key": "sk-live-secret"',
    ].join('\n');

    const redacted = redactText(raw);

    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(redacted).not.toContain('abc.def-123');
    expect(redacted).not.toContain('cesar@example.com');
    expect(redacted).not.toContain('(415) 555-0199');
    expect(redacted).not.toContain('/Users/cesar/.claude');
    expect(redacted).not.toContain('~/.codex/auth.json');
    expect(redacted).not.toContain('sk-live-secret');
    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('token=[REDACTED]');
  });

  it('masks AWS ids, IP literals, env-style secret names, and generic home paths', () => {
    const raw = [
      'ANTHROPIC_API_KEY=anthropic-secret',
      'AWS_SECRET_ACCESS_KEY=aws-secret',
      'aws key AKIAIOSFODNN7EXAMPLE',
      'daemon listening on 10.42.0.12 and fd00:abcd:1234::99',
      'workspace /Users/cesar/projects/myapp and /home/alex/.config/myapp',
      JSON.stringify({ message: 'The harmless field carried AKIAZZZZZZZZZZZZZZZZ' }),
    ].join('\n');

    const redacted = redactText(raw);

    expect(redacted).not.toContain('anthropic-secret');
    expect(redacted).not.toContain('aws-secret');
    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redacted).not.toContain('AKIAZZZZZZZZZZZZZZZZ');
    expect(redacted).not.toContain('10.42.0.12');
    expect(redacted).not.toContain('fd00:abcd:1234::99');
    expect(redacted).not.toContain('/Users/cesar/projects/myapp');
    expect(redacted).not.toContain('/home/alex/.config/myapp');
    expect(redacted).toContain('ANTHROPIC_API_KEY=[REDACTED]');
    expect(redacted).toContain('[REDACTED_AWS_ACCESS_KEY]');
    expect(redacted).toContain('[REDACTED_IP]');
    expect(redacted).toContain('[HOME]');
  });

  it('masks base64-encoded home paths before the residual high-entropy scan', () => {
    const encodedPath = Buffer.from('/Users/cesar/projects/myapp').toString('base64').replace(/=+$/u, '');
    const raw = `workloop persistence directory: [HOME]/durable/workloop-persistence/${encodedPath}`;

    const redacted = redactText(raw);

    expect(redacted).not.toContain(encodedPath);
    expect(redacted).toContain('[REDACTED_BASE64_PATH]');
    expect(scanResidualSecrets(redacted, 'evidence.json')).toEqual([]);
  });

  it('preserves JSON shape while masking fuzzy secret keys', () => {
    const value = {
      user: {
        emailAddress: 'tester@example.com',
        name: 'Tester',
      },
      auth: {
        accessToken: 'secret-token',
        cookieJar: ['session=abc', 'prefs=ok'],
      },
      count: 3,
    };

    expect(redactJson(value)).toEqual({
      user: {
        emailAddress: '[REDACTED]',
        name: 'Tester',
      },
      auth: {
        accessToken: '[REDACTED]',
        cookieJar: ['[REDACTED]', '[REDACTED]'],
      },
      count: 3,
    });
  });
});

describe('redactDir', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('walks committed text artifact types including HTML and NDJSON', async () => {
    dir = mkdtempSync(join(tmpdir(), 'redact-dir-'));
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'report.html'), '<div>token=html-secret cesar@example.com</div>');
    writeFileSync(
      join(dir, 'evidence.json'),
      JSON.stringify({ message: 'token=secret123', safe: true }),
    );
    writeFileSync(
      join(dir, 'nested', 'events.ndjson'),
      '{"token":"ndjson-secret","message":"token=message-secret"}\n{"safe":true}\n',
    );
    writeFileSync(join(dir, 'image.png'), 'token=not-read');

    const result = await redactDir(dir);

    expect(result.redactions).toBeGreaterThanOrEqual(3);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: join(dir, 'image.png'), reason: 'image_unredacted' }),
    ]);
    expect(readFileSync(join(dir, 'report.html'), 'utf-8')).toBe(
      '<div>token=[REDACTED] [REDACTED_EMAIL]</div>',
    );
    expect(JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf-8'))).toEqual({
      message: 'token=[REDACTED]',
      safe: true,
    });
    expect(readFileSync(join(dir, 'nested', 'events.ndjson'), 'utf-8')).toContain(
      '"token":"[REDACTED]"',
    );
    expect(readFileSync(join(dir, 'nested', 'events.ndjson'), 'utf-8')).toContain(
      '"message":"token=[REDACTED]"',
    );
    expect(readFileSync(join(dir, 'image.png'), 'utf-8')).toBe('token=not-read');
  });

  it('reports write failures without counting unsaved redactions as successful', async () => {
    dir = mkdtempSync(join(tmpdir(), 'redact-dir-fail-'));
    const protectedFile = join(dir, 'evidence.json');
    writeFileSync(protectedFile, JSON.stringify({ message: 'token=still-secret' }));
    chmodSync(protectedFile, 0o400);

    const result = await redactDir(dir);
    chmodSync(protectedFile, 0o600);

    expect(result.redactions).toBe(0);
    expect(result.failures).toEqual([
      expect.objectContaining({ path: protectedFile, reason: 'write_failed' }),
    ]);
    expect(readFileSync(protectedFile, 'utf-8')).toContain('still-secret');
  });
});

describe('scanResidualSecrets', () => {
  it('finds known secret prefixes and reports offsets', () => {
    const text = 'safe prefix\nleaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\n';

    const hits = scanResidualSecrets(text, 'report.md');

    expect(hits).toEqual([
      expect.objectContaining({
        path: 'report.md',
        prefix: 'sk-ant-',
        offset: text.indexOf('sk-ant-'),
      }),
    ]);
  });

  it('does not classify timestamped report artifact filenames as high-entropy secrets', () => {
    const text = 'HTML trace: `/tmp/bugs/20260623-194605-bug-causal-timeline.html`\n';

    expect(scanResidualSecrets(text, 'report.md')).toEqual([]);
  });

  it('exempts app-specific artifact names via opts.allowNames', () => {
    const text = 'Capture log: capture-Zx9kQ2mP8vTn4Lw7Jc3Ryd5Bh6NfKa0qWe1.ndjson\n';

    expect(scanResidualSecrets(text, 'report.md').length).toBeGreaterThan(0);
    expect(
      scanResidualSecrets(text, 'report.md', {
        allowNames: [/^capture-[A-Za-z0-9]+\.ndjson$/],
      }),
    ).toEqual([]);
  });
});
