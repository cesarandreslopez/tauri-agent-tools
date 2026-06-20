import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { addBridgeOptions, type BridgeOpts } from './shared.js';
import { exec } from '../util/exec.js';

interface BundleOpts extends BridgeOpts {
  config?: string;
  identifier?: string;
  out?: string;
  since?: string;
  withCapture?: boolean;
  archive?: boolean; // commander negation: false when --no-archive
  json?: boolean;
}

interface PhaseOutcome {
  phase: string;
  ok: boolean;
  detail: string;
}

export function registerBundle(program: Command): void {
  const cmd = new Command('bundle')
    .description(
      'Collect a shareable incident bundle: merged logs, deep process tree, app paths, forensics ' +
        '(and optionally a UI capture) into one redacted directory + .tar.gz. Best-effort — degrades cleanly.',
    )
    .option('--config <path>', 'Path to tauri.conf.json (or its directory). Auto-detected if omitted.')
    .option('--identifier <id>', 'Bundle identifier override')
    .option('-o, --out <dir>', 'Output directory (default: ./bundle-<timestamp>)')
    .option('--since <duration>', 'How far back to pull from app log files (forensics phase, default: 10m)')
    .option('--with-capture', 'Also capture a UI snapshot (screenshot + DOM); needs a live bridge')
    .option('--no-archive', 'Skip the final .tar.gz (leave the directory only)')
    .option('--json', 'Print the summary as JSON in addition to writing it to disk');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BundleOpts) => {
    const outDir = opts.out ?? `./bundle-${timestampSlug()}`;
    await mkdir(outDir, { recursive: true });

    const outcomes: PhaseOutcome[] = [];

    // ── Merged logs (bridge-optional + on-disk files) ───────────────────────
    {
      const args = ['logs', '--json'];
      if (opts.config) args.push('--config', opts.config);
      if (opts.identifier) args.push('--identifier', opts.identifier);
      forwardBridge(args, opts);
      outcomes.push(await runCapturingStdout(args, join(outDir, 'logs.ndjson')));
    }

    // ── Deep OS process tree ────────────────────────────────────────────────
    {
      const args = ['process-tree', '--deep', '--json'];
      forwardBridge(args, opts);
      outcomes.push(await runCapturingStdout(args, join(outDir, 'process-tree.json')));
    }

    // ── App paths ───────────────────────────────────────────────────────────
    {
      const args = ['app-paths', '--platform', 'all', '--exists', '--json'];
      if (opts.config) args.push('--config', opts.config);
      if (opts.identifier) args.push('--identifier', opts.identifier);
      outcomes.push(await runCapturingStdout(args, join(outDir, 'app-paths.json')));
    }

    // ── Forensics bundle (bridge-free; works on a dead app) ─────────────────
    {
      const args = ['forensics', '-o', join(outDir, 'forensics')];
      if (opts.config) args.push('--config', opts.config);
      if (opts.identifier) args.push('--identifier', opts.identifier);
      if (opts.since) args.push('--since', opts.since);
      outcomes.push(await runToDir('forensics', args));
    }

    // ── Optional UI capture (needs a live bridge + screenshot tools) ────────
    if (opts.withCapture) {
      const args = ['capture', '-o', join(outDir, 'capture'), '--json'];
      forwardBridge(args, opts);
      outcomes.push(await runToDir('capture', args));
    }

    // ── Redact obvious secrets across all collected text files ──────────────
    const redacted = await redactDir(outDir);
    outcomes.push({ phase: 'redact', ok: true, detail: `redacted ${redacted} value(s)` });

    // ── Summary ─────────────────────────────────────────────────────────────
    const summary = {
      outDir,
      createdPhases: outcomes,
      ok: outcomes.filter((o) => o.ok).length,
      total: outcomes.length,
    };
    await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    await writeFile(join(outDir, 'summary.md'), renderSummary(outDir, outcomes));

    // ── Archive ─────────────────────────────────────────────────────────────
    let archivePath: string | null = null;
    if (opts.archive !== false) {
      archivePath = `${outDir.replace(/\/+$/, '')}.tar.gz`;
      try {
        await exec('tar', ['-czf', archivePath, '-C', dirnameOf(outDir), basenameOf(outDir)]);
        outcomes.push({ phase: 'archive', ok: true, detail: `→ ${archivePath}` });
      } catch (e) {
        archivePath = null;
        outcomes.push({
          phase: 'archive',
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ ...summary, archive: archivePath }, null, 2));
    } else {
      console.log(`✓ Incident bundle written to ${outDir}`);
      console.log(`  ${summary.ok}/${summary.total} phases succeeded`);
      if (archivePath) console.log(`  Archive: ${archivePath}`);
      console.log(`  Open ${join(outDir, 'summary.md')} first.`);
    }
  });

  program.addCommand(cmd);
}

function forwardBridge(args: string[], opts: BridgeOpts): void {
  if (opts.port !== undefined) args.push('--port', String(opts.port));
  if (opts.token !== undefined) args.push('--token', opts.token);
  if (opts.pid !== undefined) args.push('--pid', String(opts.pid));
  if (opts.windowLabel !== undefined) args.push('--window-label', opts.windowLabel);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function dirnameOf(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '.' : norm.slice(0, idx);
}

function basenameOf(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? norm : norm.slice(idx + 1);
}

/** Spawn this same CLI binary, capturing stdout into `outFile`. */
function runCapturingStdout(args: string[], outFile: string): Promise<PhaseOutcome> {
  return new Promise((resolve) => {
    const cliPath = process.argv[1];
    if (!cliPath) {
      resolve({ phase: args[0] ?? 'phase', ok: false, detail: 'could not locate CLI binary' });
      return;
    }
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) =>
      resolve({ phase: args[0] ?? 'phase', ok: false, detail: err.message }),
    );
    child.on('close', async (code) => {
      try {
        await writeFile(outFile, stdout);
      } catch {
        /* ignore write failure */
      }
      resolve({
        phase: args[0] ?? 'phase',
        ok: code === 0,
        detail: code === 0 ? `→ ${outFile}` : `exit ${code}${stderr ? ': ' + stderr.trim().slice(0, 200) : ''}`,
      });
    });
  });
}

/** Spawn this CLI binary for a command that writes its own output directory. */
function runToDir(phase: string, args: string[]): Promise<PhaseOutcome> {
  return new Promise((resolve) => {
    const cliPath = process.argv[1];
    if (!cliPath) {
      resolve({ phase, ok: false, detail: 'could not locate CLI binary' });
      return;
    }
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) => resolve({ phase, ok: false, detail: err.message }));
    child.on('close', (code) =>
      resolve({
        phase,
        ok: code === 0,
        detail: code === 0 ? 'ok' : `exit ${code}${stderr ? ': ' + stderr.trim().slice(0, 200) : ''}`,
      }),
    );
  });
}

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/("token"\s*:\s*")[^"]+(")/gi, '$1***$2'],
  [/\btoken=([\w.\-]+)/gi, 'token=***'],
  [/("(?:authorization|api[_-]?key|secret|password)"\s*:\s*")[^"]+(")/gi, '$1***$2'],
];

/** Walk the bundle dir and redact obvious secrets from text files. Returns count of redactions. */
async function redactDir(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      total += await redactDir(full);
      continue;
    }
    if (!/\.(json|ndjson|txt|md|log)$/i.test(name)) continue;
    let content: string;
    try {
      content = await readFile(full, 'utf-8');
    } catch {
      continue;
    }
    let changed = false;
    for (const [re, repl] of REDACT_PATTERNS) {
      const next = content.replace(re, (...a) => {
        total += 1;
        return interpolate(repl, a);
      });
      if (next !== content) {
        content = next;
        changed = true;
      }
    }
    if (changed) await writeFile(full, content).catch(() => {});
  }
  return total;
}

function interpolate(template: string, matchArgs: unknown[]): string {
  return template.replace(/\$(\d)/g, (_, d: string) => String(matchArgs[Number(d)] ?? ''));
}

function renderSummary(outDir: string, outcomes: PhaseOutcome[]): string {
  const rows = outcomes.map((o) => `- ${o.ok ? '✓' : '✗'} **${o.phase}** — ${o.detail}`).join('\n');
  return `# Incident bundle

- **Output:** \`${outDir}\`

## Contents

- \`logs.ndjson\` — merged, timestamp-ordered logs (bridge ring buffer + on-disk log files)
- \`process-tree.json\` — full OS process descendant tree (sidecars + grandchildren)
- \`app-paths.json\` — resolved per-platform data/log/cache/config dirs (with existence)
- \`forensics/\` — post-mortem bundle (app-log tail, panic markers, OS-log tail, app-data listing)
- \`capture/\` — UI snapshot (only when \`--with-capture\` and a bridge were available)

## Phases

${rows}

## Notes

Secrets (\`token\`, \`api_key\`, \`password\`, …) were redacted from text artifacts on write.
Re-run any individual command directly for live/interactive inspection.
`;
}
