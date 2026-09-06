import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { addBridgeOptions, type BridgeOpts } from './shared.js';
import { exec } from '../util/exec.js';
import { redactDir, redactJson, redactText, scanResidualSecrets } from '../util/redactText.js';
import { artifactFiles, publishArtifacts, publishFile } from '../util/incidentFiles.js';
import { CliError } from '../errors.js';

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
    const output = resolve(outDir);
    if (dirname(output) === output) throw new Error('Choose an output directory below the filesystem root.');
    const stage = await mkdtemp(join(tmpdir(), 'tauri-bundle-'));
    const collected = join(stage, basename(output));
    try {
      await mkdir(collected);
      const outcomes: PhaseOutcome[] = [];
      const targeting = (args: string[]): string[] => { forwardBridge(args, opts); return args; };
      const project = (args: string[]): string[] => {
        if (opts.config) args.push('--config', opts.config);
        if (opts.identifier) args.push('--identifier', opts.identifier);
        return args;
      };
      outcomes.push(await runCapturingStdout(targeting(project(['logs', '--json'])), join(collected, 'logs.ndjson')));
      outcomes.push(await runCapturingStdout(targeting(['process-tree', '--deep', '--json']), join(collected, 'process-tree.json')));
      outcomes.push(await runCapturingStdout(project(['app-paths', '--platform', 'all', '--exists', '--json']), join(collected, 'app-paths.json')));
      const forensicArgs = project(['forensics', '-o', join(collected, 'forensics')]);
      if (opts.since) forensicArgs.push('--since', opts.since);
      outcomes.push(await runToDir('forensics', forensicArgs));
      if (opts.withCapture) {
        outcomes.push(await runToDir('capture', targeting(['capture', '-o', join(collected, 'capture'), '--json'])));
      }

      const redacted = await redactDir(collected, { verify: true, relativeTo: collected });
      const warnings = redacted.warnings.map(issue => ({ ...issue, path: relative(collected, issue.path) }));
      if (redacted.failures.length) {
        const details = redacted.failures.map(issue => `${relative(collected, issue.path)} (${issue.reason})`).join(', ');
        throw new CliError('REDACTION_FAILED', `Bundle was not published: ${details}`, 'Resolve the listed redaction failures before generating a shareable bundle.');
      }
      outcomes.push({ phase: 'redact', ok: true,
        detail: `redacted ${redacted.redactions} value(s), ${warnings.length} warning(s), 0 failure(s)` });
      const artifacts = [...await artifactFiles(collected), 'summary.json', 'summary.md'].sort();
      let archivePath: string | null = opts.archive === false ? null : `${output}.tar.gz`;
      if (archivePath) outcomes.push({ phase: 'archive', ok: true, detail: `→ ${archivePath}` });

      const writeSummary = async () => {
        const normalized = outcomes.map(o => ({ ...o, detail: o.detail.split(collected).join('.') }));
        const summary = redactJson({ outDir, createdPhases: normalized,
          ok: normalized.filter(o => o.ok).length, total: normalized.length,
          partial: normalized.some(o => !o.ok), warnings, artifacts, archive: archivePath });
        const json = JSON.stringify(summary, null, 2);
        const markdown = redactText(renderSummary(outDir, normalized) +
          (warnings.length ? '\n## Warnings\n\n' + warnings.map(w => `- ${w.path}: ${w.reason}`).join('\n') + '\n' : ''));
        if (scanResidualSecrets(json, 'summary.json').length || scanResidualSecrets(markdown, 'summary.md').length) {
          throw new CliError('REDACTION_FAILED', 'Bundle summary contains a possible credential', 'Remove credentials from output paths and retry.');
        }
        await writeFile(join(collected, 'summary.json'), json);
        await writeFile(join(collected, 'summary.md'), markdown);
        return summary;
      };
      let summary = await writeSummary();
      const stagedArchive = join(stage, 'archive.tar.gz');
      if (archivePath) {
        try {
          const metadataFlags = process.platform === 'darwin' ? ['--no-mac-metadata'] : [];
          await exec('tar', [...metadataFlags, '-czf', stagedArchive, '-C', stage, '--', basename(collected)]);
        } catch (error) {
          archivePath = null;
          outcomes[outcomes.length - 1] = { phase: 'archive', ok: false, detail: error instanceof Error ? error.message : String(error) };
          summary = await writeSummary();
        }
      }
      await publishArtifacts(collected, output);
      if (archivePath) {
        try { await publishFile(stagedArchive, archivePath); }
        catch (error) {
          archivePath = null;
          outcomes[outcomes.length - 1] = { phase: 'archive', ok: false, detail: error instanceof Error ? error.message : String(error) };
          summary = await writeSummary();
          await publishFile(join(collected, 'summary.json'), join(output, 'summary.json'));
          await publishFile(join(collected, 'summary.md'), join(output, 'summary.md'));
        }
      }
      if (opts.json) console.log(JSON.stringify(summary, null, 2));
      else {
        console.log(`Incident bundle written to ${outDir}`);
        console.log(`  ${outcomes.filter(o => o.ok).length}/${outcomes.length} phases succeeded`);
        if (archivePath) console.log(`  Archive: ${archivePath}`);
        for (const warning of warnings) console.log(`  Warning: ${warning.path} (${warning.reason})`);
        console.log(`  Open ${join(outDir, 'summary.md')} first.`);
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
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
      } catch (error) {
        resolve({ phase: args[0] ?? 'phase', ok: false, detail: `Could not write artifact: ${String(error)}` });
        return;
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
    child.on('close', async (code) => {
      let detail = code === 0 ? 'ok' : `exit ${code}${stderr ? ': ' + stderr.trim().slice(0, 200) : ''}`;
      let ok = code === 0;
      if (ok) {
        try {
          const dir = args[args.indexOf('-o') + 1]!;
          const file = phase === 'capture' ? 'manifest.json' : 'summary.json';
          const manifest = JSON.parse(await readFile(join(dir, file), 'utf8')) as { errorCount?: number; partial?: boolean; phases?: PhaseOutcome[] };
          const failed = manifest.errorCount ?? manifest.phases?.filter(p => !p.ok).length ?? 0;
          if (failed) { ok = false; detail = `${failed} artifact/collection phase(s) failed; see ${phase}/${file}`; }
          else if (manifest.partial) { ok = false; detail = `Partial capture; see ${phase}/${file} for warnings`; }
        } catch (error) { ok = false; detail = `Could not read ${phase} manifest: ${String(error)}`; }
      }
      resolve({ phase, ok, detail });
    });
  });
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

Secrets (\`token\`, \`api_key\`, \`password\`, JWTs, AWS keys, …) and PII (emails, IPs,
phone numbers, home paths) were redacted from text artifacts on write. Images are
not redacted and are flagged as warnings in the redact phase.
Re-run any individual command directly for live/interactive inspection.
`;
}
