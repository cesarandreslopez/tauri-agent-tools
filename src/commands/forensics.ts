import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { LineFramer } from '../util/ndjson.js';
import { resolveTauriProject } from '../util/tauriConfig.js';
import { buildArgs as buildDarwinArgs, parseLine as parseDarwinLine } from '../platform/oslog/darwin.js';
import { buildArgs as buildLinuxArgs, parseLine as parseLinuxLine } from '../platform/oslog/linux.js';
import type { NormalizedLogEntry } from '../schemas/osLog.js';

interface ForensicsOpts {
  config?: string;
  identifier?: string;
  out?: string;
  since?: string;
  logsDuration?: string;
  json?: boolean;
}

interface FileSummary {
  path: string;
  size: number;
  mtime: string;
}

interface PhaseOutcome {
  phase: string;
  ok: boolean;
  detail: string;
}

const PANIC_MARKERS = [
  'panicked at',
  'panic occurred',
  'SIGSEGV',
  'SIGABRT',
  'fatal runtime error',
  'thread \'main\' panicked',
  'Uncaught',
  'unhandledRejection',
];

export function registerForensics(program: Command): void {
  const cmd = new Command('forensics')
    .description("Bundle a forensic snapshot of a Tauri app (paths, logs, crash reports). Works on dead apps.")
    .option('--config <path>', 'Path to tauri.conf.json (or its directory). Auto-detected if omitted.')
    .option('--identifier <id>', 'Bundle identifier override')
    .option('-o, --out <dir>', 'Output directory (default: ./forensics-<timestamp>)')
    .option('--since <duration>', 'How far back to pull from app log files (default: 10m)')
    .option(
      '--logs-duration <ms>',
      'Time budget for the live OS-log tail in milliseconds (default: 3000)',
      parsePositiveInt,
    )
    .option('--json', 'Print the summary as JSON to stdout in addition to writing to disk')
    .action(async (opts: ForensicsOpts) => {
      const outDir = opts.out ?? `./forensics-${timestampSlug()}`;
      await mkdir(outDir, { recursive: true });

      const outcomes: PhaseOutcome[] = [];
      const summary: Record<string, unknown> = { phases: outcomes };

      // ── Phase 1: Resolve project + paths ─────────────────────────────────
      const resolved = await safe(async () =>
        resolveTauriProject({ configPath: opts.config, identifierOverride: opts.identifier }),
      );
      if (!resolved.ok) {
        outcomes.push({ phase: 'resolve-config', ok: false, detail: resolved.error });
        await writeSummary(outDir, summary, opts.json);
        throw new Error(`Could not resolve Tauri config: ${resolved.error}`);
      }
      const project = resolved.value;
      outcomes.push({
        phase: 'resolve-config',
        ok: true,
        detail: `identifier=${project.identifier} productName=${project.productName}`,
      });
      summary['identifier'] = project.identifier;
      summary['productName'] = project.productName;
      summary['configPath'] = project.configPath;
      summary['platform'] = project.platform;
      summary['paths'] = project.paths[project.platform];

      // ── Phase 2: List files in app-data + app-log directories ────────────
      const dataFiles = await safeListDir(project.paths[project.platform].appDataDir);
      const logFiles = await safeListDir(project.paths[project.platform].appLogDir);
      summary['appDataFiles'] = dataFiles.files;
      summary['appLogFiles'] = logFiles.files;
      outcomes.push({
        phase: 'list-app-data',
        ok: dataFiles.ok,
        detail: dataFiles.ok ? `${dataFiles.files.length} files` : dataFiles.detail,
      });
      outcomes.push({
        phase: 'list-app-log',
        ok: logFiles.ok,
        detail: logFiles.ok ? `${logFiles.files.length} files` : logFiles.detail,
      });

      // ── Phase 3: Tail the most-recently-modified app log file ────────────
      const newestLog = pickNewest(logFiles.files);
      let logTail: string[] = [];
      let panicLines: string[] = [];
      if (newestLog) {
        const tailResult = await safe(async () => tailFile(newestLog.path, 200));
        if (tailResult.ok) {
          logTail = tailResult.value;
          panicLines = logTail.filter((l) => PANIC_MARKERS.some((m) => l.includes(m)));
          outcomes.push({
            phase: 'tail-app-log',
            ok: true,
            detail: `${logTail.length} lines, ${panicLines.length} panic marker(s)`,
          });
          await writeFile(join(outDir, 'app-log-tail.txt'), logTail.join('\n'));
        } else {
          outcomes.push({ phase: 'tail-app-log', ok: false, detail: tailResult.error });
        }
      } else {
        outcomes.push({ phase: 'tail-app-log', ok: false, detail: 'no app log files found' });
      }
      summary['logTailLineCount'] = logTail.length;
      summary['panicLines'] = panicLines;

      // ── Phase 4: macOS DiagnosticReports (skip on other platforms) ───────
      let diagnosticReports: FileSummary[] = [];
      if (project.platform === 'darwin') {
        const drDir = `${homedir()}/Library/Logs/DiagnosticReports`;
        if (existsSync(drDir)) {
          const all = await safeListDir(drDir);
          // Filter to entries whose name starts with productName (macOS naming convention).
          diagnosticReports = all.files
            .filter((f) => basename(f.path).startsWith(project.productName))
            .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
            .slice(0, 5);
          outcomes.push({
            phase: 'macos-diagnostic-reports',
            ok: true,
            detail: `${diagnosticReports.length} report(s) matching productName`,
          });
        } else {
          outcomes.push({
            phase: 'macos-diagnostic-reports',
            ok: false,
            detail: `${drDir} not accessible`,
          });
        }
      }
      summary['diagnosticReports'] = diagnosticReports;

      // ── Phase 5: Live OS-log tail (best-effort) ──────────────────────────
      const liveLogs: NormalizedLogEntry[] = [];
      const budgetMs = (opts.logsDuration as unknown as number | undefined) ?? 3000;
      if (project.platform === 'darwin' || project.platform === 'linux') {
        const livRes = await safe(async () =>
          collectLiveLogs(project.identifier, project.productName, budgetMs, project.platform),
        );
        if (livRes.ok) {
          liveLogs.push(...livRes.value);
          outcomes.push({
            phase: 'live-os-log-tail',
            ok: true,
            detail: `${liveLogs.length} entries in ${budgetMs}ms`,
          });
          await writeFile(
            join(outDir, 'live-os-log.ndjson'),
            liveLogs.map((e) => JSON.stringify(e)).join('\n'),
          );
        } else {
          outcomes.push({ phase: 'live-os-log-tail', ok: false, detail: livRes.error });
        }
      } else {
        outcomes.push({
          phase: 'live-os-log-tail',
          ok: false,
          detail: `not implemented on ${project.platform}`,
        });
      }
      summary['liveLogEntries'] = liveLogs.length;

      // ── Phase 6: Write artifacts to outDir ───────────────────────────────
      await writeFile(join(outDir, 'project.json'), JSON.stringify(project, null, 2));
      await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
      await writeFile(join(outDir, 'summary.md'), renderMarkdown(summary, outcomes, project, panicLines, logTail));

      summary['outDir'] = outDir;

      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`✓ Forensic bundle written to ${outDir}`);
        console.log(`  ${outcomes.filter((o) => o.ok).length}/${outcomes.length} phases succeeded`);
        if (panicLines.length > 0) {
          console.log(`  ⚠ ${panicLines.length} panic marker(s) in the most-recent log`);
        }
      }
    });

  program.addCommand(cmd);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function safeListDir(
  dir: string,
): Promise<{ ok: boolean; files: FileSummary[]; detail: string }> {
  if (!existsSync(dir)) {
    return { ok: false, files: [], detail: `${dir} does not exist` };
  }
  try {
    const entries = await readdir(dir);
    const files: FileSummary[] = [];
    for (const name of entries) {
      const path = join(dir, name);
      try {
        const st = await stat(path);
        if (!st.isFile()) continue;
        files.push({ path, size: st.size, mtime: st.mtime.toISOString() });
      } catch {
        // Skip unreadable entries (permission denied, etc.)
      }
    }
    return { ok: true, files, detail: `${files.length} files` };
  } catch (err) {
    return {
      ok: false,
      files: [],
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function pickNewest(files: FileSummary[]): FileSummary | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => (a.mtime < b.mtime ? 1 : -1))[0] ?? null;
}

async function tailFile(path: string, lines: number): Promise<string[]> {
  // Naive impl: read whole file, slice last N. Good enough for "tail the most
  // recent app log" since these files are typically rotated/small.
  const text = await readFile(path, 'utf-8');
  return text.split(/\r?\n/).slice(-lines).filter((l) => l.length > 0);
}

async function collectLiveLogs(
  identifier: string,
  productName: string,
  budgetMs: number,
  platform: 'darwin' | 'linux' | 'win32',
): Promise<NormalizedLogEntry[]> {
  if (platform === 'win32') return [];
  const args = platform === 'darwin'
    ? buildDarwinArgs({ identifier, productName })
    : buildLinuxArgs({ identifier, productName, since: `${Math.ceil(budgetMs / 1000)}s ago` });
  const cmdBin = platform === 'darwin' ? 'log' : 'journalctl';
  const parser = platform === 'darwin' ? parseDarwinLine : parseLinuxLine;

  const child = spawn(cmdBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const framer = new LineFramer();
  const entries: NormalizedLogEntry[] = [];

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of framer.push(chunk)) {
      const e = parser(line);
      if (e) entries.push(e);
    }
  });

  const timer = setTimeout(() => child.kill('SIGTERM'), budgetMs);
  await new Promise<void>((resolve) => {
    child.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(); // swallow — forensics is best-effort
    });
  });
  return entries;
}

async function writeSummary(
  outDir: string,
  summary: Record<string, unknown>,
  alsoStdout: boolean | undefined,
): Promise<void> {
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  if (alsoStdout) console.log(JSON.stringify(summary, null, 2));
}

function renderMarkdown(
  summary: Record<string, unknown>,
  outcomes: PhaseOutcome[],
  project: Awaited<ReturnType<typeof resolveTauriProject>>,
  panicLines: string[],
  logTail: string[],
): string {
  const phases = outcomes
    .map((o) => `- ${o.ok ? '✓' : '✗'} **${o.phase}** — ${o.detail}`)
    .join('\n');

  const dataFiles = (summary['appDataFiles'] as FileSummary[] | undefined) ?? [];
  const logFiles = (summary['appLogFiles'] as FileSummary[] | undefined) ?? [];
  const dataList = dataFiles.length === 0
    ? '_no files_'
    : dataFiles.map((f) => `- \`${f.path}\` (${f.size} bytes, ${f.mtime})`).join('\n');
  const logList = logFiles.length === 0
    ? '_no files_'
    : logFiles.map((f) => `- \`${f.path}\` (${f.size} bytes, ${f.mtime})`).join('\n');

  const panicBlock = panicLines.length === 0
    ? '_none_'
    : panicLines.map((l) => '    ' + l).join('\n');

  const tailBlock = logTail.length === 0
    ? '_no log file to tail_'
    : '```\n' + logTail.slice(-20).join('\n') + '\n```';

  return `# Forensics: ${project.productName}

- **Identifier:** \`${project.identifier}\`
- **Platform:** ${project.platform}
- **Config:** \`${project.configPath}\`

## Phases

${phases}

## Resolved paths (current platform)

\`\`\`json
${JSON.stringify(project.paths[project.platform], null, 2)}
\`\`\`

## App data files

${dataList}

## App log files

${logList}

## Panic markers in most-recent log

\`\`\`
${panicBlock}
\`\`\`

## Tail of most-recent log (last 20 lines)

${tailBlock}

## Suggested next steps

${suggestNextSteps(project, panicLines, logTail, outcomes)}
`;
}

function suggestNextSteps(
  project: { identifier: string; productName: string; platform: string },
  panicLines: string[],
  logTail: string[],
  outcomes: PhaseOutcome[],
): string {
  const tips: string[] = [];
  if (panicLines.length > 0) {
    tips.push(
      `- A panic was detected. Run \`tauri-agent-tools os-logs --identifier ${project.identifier} --level error --since 30m --json\` to fetch surrounding error-level entries.`,
    );
  }
  if (logTail.length === 0) {
    tips.push(
      `- No app log file found. Verify the app actually writes to \`appLogDir\` (default for Tauri is via \`tauri-plugin-log\`).`,
    );
  }
  if (outcomes.some((o) => o.phase === 'live-os-log-tail' && !o.ok)) {
    tips.push(
      `- Live OS-log tail failed. Check that \`${project.platform === 'darwin' ? 'log' : 'journalctl'}\` is on PATH.`,
    );
  }
  if (tips.length === 0) {
    tips.push(`- No specific anomalies detected. Inspect the artifacts in this folder for context.`);
  }
  return tips.join('\n');
}

function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return n;
}
