import { Command } from 'commander';
import { addBridgeOptions, resolveBridge, parsePositiveInt } from './shared.js';
import type { BridgeOpts } from './shared.js';
import { evaluateExpression } from '../bridge/evaluate.js';
import { consoleObserver, readObserver, closeObserver } from '../bridge/observers.js';
import { monitorFor, createSignalScope } from '../util/monitor.js';
import { ConsoleEntrySchema } from '../schemas/commands.js';
import { z } from 'zod';
import { CliError } from '../errors.js';
import type { CheckItem } from '../schemas/commands.js';

export function buildSelectorCheck(selector: string): string {
  return `!!document.querySelector(${JSON.stringify(selector)})`;
}

export function buildEvalCheck(expression: string): string {
  return expression;
}

export function buildTextCheck(pattern: string): string {
  return `document.body.textContent.includes(${JSON.stringify(pattern)})`;
}

export function registerCheck(program: Command): void {
  const cmd = new Command('check')
    .description('Run structured assertions against the Tauri app and exit nonzero on failure')
    .option('--selector <css>', 'Assert that a CSS selector matches an element')
    .option('--eval <js>', 'Assert that a JavaScript expression is truthy')
    .option('--text <pattern>', 'Assert that body text contains the pattern')
    .option('--no-errors', 'Assert that no console.error calls occurred during --duration')
    .option('--duration <ms>', 'Duration to wait for --no-errors check (ms)', parsePositiveInt, 3000)
    .option('--json', 'Output results as JSON');

  addBridgeOptions(cmd);

  cmd.action(async (opts: BridgeOpts & {
    selector?: string;
    eval?: string;
    text?: string;
    errors?: boolean;
    duration: number;
    json?: boolean;
  }) => {
    if (opts.selector === undefined && opts.eval === undefined && opts.text === undefined && opts.errors !== false) {
      throw new CliError('INVALID_ARGUMENT', 'At least one assertion is required', 'Use --selector, --eval, --text, or --no-errors.');
    }
    const bridge = await resolveBridge(opts);
    const checks: CheckItem[] = [];

    // Selector check
    if (opts.selector !== undefined) {
      try {
        const js = buildSelectorCheck(opts.selector);
        const result = await evaluateExpression(bridge, js);
        checks.push({
          type: 'selector',
          passed: result.truthy,
          selector: opts.selector,
        });
      } catch (err) {
        checks.push({
          type: 'selector',
          passed: false,
          selector: opts.selector,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Eval check
    if (opts.eval !== undefined) {
      try {
        const js = buildEvalCheck(opts.eval);
        const result = await evaluateExpression(bridge, js);
        checks.push({
          type: 'eval',
          passed: result.truthy,
          expression: opts.eval,
        });
      } catch (err) {
        checks.push({
          type: 'eval',
          passed: false,
          expression: opts.eval,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Text check
    if (opts.text !== undefined) {
      try {
        const js = buildTextCheck(opts.text);
        const result = await evaluateExpression(bridge, js);
        checks.push({
          type: 'text',
          passed: result.truthy,
          pattern: opts.text,
        });
      } catch (err) {
        checks.push({
          type: 'text',
          passed: false,
          pattern: opts.text,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // No-errors check (opts.errors === false when --no-errors is passed)
    if (opts.errors === false) {
      const scripts = consoleObserver();
      const signals = createSignalScope();
      const errors: string[] = [];
      const warnings: string[] = [];
      const warn = (message: string) => { warnings.push(message); console.error(message); };
      try {
        const status = await bridge.eval(scripts.patch);
        if (status !== 'patched') throw new Error(`Observer setup failed: ${String(status)}`);
        const outcome = await monitorFor({ interval: Math.min(500, opts.duration), duration: opts.duration, signal: signals.signal }, async () => {
          const entries = z.array(ConsoleEntrySchema).parse(await readObserver(bridge, scripts, warn));
          errors.push(...entries.filter(e => e.level === 'error').map(e => e.message));
        });
        checks.push({ type: 'no-errors', passed: errors.length === 0 && outcome === 'completed', errors });
      } catch (err) {
        checks.push({ type: 'no-errors', passed: false, errors, error: err instanceof Error ? err.message : String(err) });
      } finally {
        await closeObserver(bridge, scripts, warn);
        signals.dispose();
        if (signals.signal.aborted) warn(`Observation interrupted by ${String(signals.signal.reason)}; --no-errors did not complete.`);
        if (warnings.length) {
          const check = checks[checks.length - 1]!;
          check.passed = false;
          check.error = [check.error, ...warnings].filter(Boolean).join('; ');
        }
      }
    }

    const passed = checks.every((c) => c.passed);

    if (opts.json) {
      console.log(JSON.stringify({ passed, checks }));
    } else {
      for (const check of checks) {
        const status = check.passed ? '[PASS]' : '[FAIL]';
        if (check.type === 'selector') {
          console.log(`${status} selector: ${check.selector ?? ''}`);
        } else if (check.type === 'eval') {
          console.log(`${status} eval: ${check.expression ?? ''}`);
        } else if (check.type === 'text') {
          console.log(`${status} text: ${check.pattern ?? ''}`);
        } else if (check.type === 'no-errors') {
          const detail = !check.passed && check.errors && check.errors.length > 0
            ? ` (${check.errors.length} error(s))`
            : '';
          console.log(`${status} no-errors${detail}`);
        }
        if (!check.passed && check.error) {
          console.error(`       error: ${check.error}`);
        }
      }
    }

    if (!passed) {
      process.exitCode = 1;
    }
  });

  program.addCommand(cmd);
}
