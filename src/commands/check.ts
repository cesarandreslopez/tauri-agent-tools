import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';
import type { BridgeOpts } from './shared.js';
import type { CheckItem } from '../schemas/commands.js';

const ERROR_PATCH_SCRIPT = `(() => {
  if (window.__tauriDevToolsErrorPatched) return 'already_patched';
  window.__tauriDevToolsOriginalConsoleError = console.error;
  window.__tauriDevToolsErrorBuffer = [];
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function(a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    window.__tauriDevToolsErrorBuffer.push(message);
    window.__tauriDevToolsOriginalConsoleError.apply(console, arguments);
  };
  window.__tauriDevToolsErrorPatched = true;
  return 'patched';
})()`;

const ERROR_DRAIN_SCRIPT = `(() => {
  var buf = window.__tauriDevToolsErrorBuffer || [];
  window.__tauriDevToolsErrorBuffer = [];
  return JSON.stringify(buf);
})()`;

const ERROR_CLEANUP_SCRIPT = `(() => {
  if (window.__tauriDevToolsOriginalConsoleError) {
    console.error = window.__tauriDevToolsOriginalConsoleError;
    delete window.__tauriDevToolsOriginalConsoleError;
    delete window.__tauriDevToolsErrorBuffer;
    delete window.__tauriDevToolsErrorPatched;
  }
  return 'cleaned';
})()`;

export function buildSelectorCheck(selector: string): string {
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `!!document.querySelector('${escaped}')`;
}

export function buildEvalCheck(expression: string): string {
  return `!!(${expression})`;
}

export function buildTextCheck(pattern: string): string {
  const escaped = pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `document.body.textContent.includes('${escaped}')`;
}

export function registerCheck(program: Command): void {
  const cmd = new Command('check')
    .description('Run structured assertions against the Tauri app and exit nonzero on failure')
    .option('--selector <css>', 'Assert that a CSS selector matches an element')
    .option('--eval <js>', 'Assert that a JavaScript expression is truthy')
    .option('--text <pattern>', 'Assert that body text contains the pattern')
    .option('--no-errors', 'Assert that no console.error calls occurred during --duration')
    .option('--duration <ms>', 'Duration to wait for --no-errors check (ms)', parseInt, 3000)
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
    const bridge = await resolveBridge(opts);
    const checks: CheckItem[] = [];

    // Selector check
    if (opts.selector !== undefined) {
      try {
        const js = buildSelectorCheck(opts.selector);
        const result = await bridge.eval(js);
        checks.push({
          type: 'selector',
          passed: result === true || result === 'true',
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
        const result = await bridge.eval(js);
        checks.push({
          type: 'eval',
          passed: result === true || result === 'true',
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
        const result = await bridge.eval(js);
        checks.push({
          type: 'text',
          passed: result === true || result === 'true',
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
      try {
        await bridge.eval(ERROR_PATCH_SCRIPT);
        await new Promise((resolve) => setTimeout(resolve, opts.duration));
        const raw = await bridge.eval(ERROR_DRAIN_SCRIPT);
        await bridge.eval(ERROR_CLEANUP_SCRIPT).catch(() => {
          // Best-effort cleanup
        });
        const errors = JSON.parse(String(raw)) as string[];
        checks.push({
          type: 'no-errors',
          passed: errors.length === 0,
          errors,
        });
      } catch (err) {
        checks.push({
          type: 'no-errors',
          passed: false,
          errors: [],
          error: err instanceof Error ? err.message : String(err),
        });
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
