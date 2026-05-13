import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { LineFramer, NdjsonValidator } from '../util/ndjson.js';
import type { SidecarEnvelope } from '../schemas/sidecar.js';

interface SidecarTapOpts {
  schema?: string;
  record?: string;
  raw?: boolean;
  json?: boolean;
}

export function registerSidecarTap(program: Command): void {
  const cmd = new Command('sidecar')
    .description('Sidecar process tools (wrap-and-run NDJSON tap, recorded replay)');
  cmd
    .command('tap')
    .description('Spawn a sidecar via its exec command, frame stdout as NDJSON, optionally validate + record')
    .argument('<command...>', 'Sidecar command and args (use -- to delimit)')
    .option('--schema <path>', 'JSON Schema (file path) to validate each envelope against')
    .option('--record <path>', 'Append the raw NDJSON stream to this file as it arrives')
    .option('--raw', 'Echo the original sidecar stdout to our stdout (alongside structured envelopes on stderr)')
    .option('--json', 'Emit structured envelopes as JSON (default)')
    .action(async (commandTokens: string[], opts: SidecarTapOpts) => {
      if (commandTokens.length === 0) {
        throw new Error('sidecar tap requires a command. Example: sidecar tap -- node my-sidecar.js');
      }
      const [exec, ...args] = commandTokens as [string, ...string[]];

      let validator: NdjsonValidator;
      if (opts.schema) {
        if (!existsSync(opts.schema)) {
          throw new Error(`Schema file not found: ${opts.schema}`);
        }
        const text = await readFile(opts.schema, 'utf-8');
        let schemaJson: unknown;
        try {
          schemaJson = JSON.parse(text);
        } catch (err) {
          throw new Error(
            `Failed to parse schema ${opts.schema}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        validator = new NdjsonValidator(schemaJson);
      } else {
        validator = new NdjsonValidator();
      }

      if (opts.record) {
        // Reset the recording file at the start of a tap session.
        await writeFile(opts.record, '');
      }

      const child = spawn(exec, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const framer = new LineFramer();
      child.stdout.setEncoding('utf-8');

      let envelopesEmitted = 0;
      let invalidCount = 0;

      child.stdout.on('data', async (chunk: string) => {
        const lines = framer.push(chunk);
        for (const line of lines) {
          if (line.length === 0) continue;
          await processLine(line, validator, opts);
          envelopesEmitted++;
          if (!validator.parse(line).ok) invalidCount++;
        }
      });

      let stderrBuf = '';
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk: string) => {
        // Forward sidecar stderr to ours, prefixed so it's distinguishable.
        stderrBuf += chunk;
        process.stderr.write(`[sidecar-stderr] ${chunk}`);
      });

      const exitCode = await new Promise<number>((resolve, reject) => {
        child.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error(`sidecar exec not found: ${exec}`));
            return;
          }
          reject(err);
        });
        child.on('close', async (code) => {
          const trailing = framer.flush();
          if (trailing) {
            await processLine(trailing, validator, opts);
            envelopesEmitted++;
          }
          resolve(code ?? 0);
        });
      });

      // Final summary on stderr so it doesn't pollute the NDJSON stream on stdout.
      process.stderr.write(
        `[sidecar-tap] exited code=${exitCode} envelopes=${envelopesEmitted} invalid=${invalidCount}${stderrBuf.length > 0 ? ' stderr_bytes=' + stderrBuf.length : ''}\n`,
      );
      if (exitCode !== 0) process.exitCode = exitCode;
    });

  program.addCommand(cmd);
}

async function processLine(
  line: string,
  validator: NdjsonValidator,
  opts: SidecarTapOpts,
): Promise<void> {
  if (opts.record) {
    await appendFile(opts.record, line + '\n');
  }

  if (opts.raw) {
    // Echo original line verbatim
    process.stdout.write(line + '\n');
    return;
  }

  const result = validator.parse(line);
  const envelope: SidecarEnvelope = result.ok
    ? {
        ts: new Date().toISOString(),
        direction: 'sidecar→',
        valid: result.valid,
        payload: result.value,
        ...(result.errors.length > 0 ? { schemaErrors: result.errors } : {}),
      }
    : {
        ts: new Date().toISOString(),
        direction: 'sidecar→',
        valid: false,
        rawLine: line,
        parseError: result.error,
      };

  console.log(JSON.stringify(envelope));
}
