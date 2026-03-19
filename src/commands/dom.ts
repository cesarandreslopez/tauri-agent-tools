import { Command } from 'commander';
import { z } from 'zod';
import { addBridgeOptions, resolveBridge, parseEnum } from './shared.js';
import { DomNodeSchema, A11yNodeSchema } from '../schemas/dom.js';
import type { DomNode, A11yNode } from '../schemas/dom.js';
import { DomModeSchema } from '../schemas/commands.js';
import type { DomMode } from '../schemas/commands.js';

function formatA11yLine(node: A11yNode, indent: number): string {
  let line = '  '.repeat(indent);
  line += `[${node.role}]`;
  if (node.name) {
    const truncated = node.name.length > 50 ? node.name.slice(0, 47) + '...' : node.name;
    line += ` "${truncated}"`;
  }
  if (node.state) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(node.state)) {
      if (key === 'level') {
        parts.push(`level=${value}`);
      } else if (key === 'current') {
        parts.push(`current`);
      } else if (value === true) {
        parts.push(key);
      } else if (value === false) {
        parts.push(`not ${key}`);
      }
    }
    if (parts.length) line += ` (${parts.join(', ')})`;
  }
  return line;
}

function printA11yTree(node: A11yNode, indent: number, maxDepth: number): string[] {
  const lines: string[] = [formatA11yLine(node, indent)];
  if (indent < maxDepth && node.children) {
    for (const child of node.children) {
      lines.push(...printA11yTree(child, indent + 1, maxDepth));
    }
  }
  return lines;
}

function formatTreeLine(node: DomNode, indent: number): string {
  let line = '  '.repeat(indent);
  line += node.tag;
  if (node.id) line += `#${node.id}`;
  if (node.classes?.length) line += `.${node.classes.join('.')}`;
  if (node.text) {
    const truncated = node.text.length > 30 ? node.text.slice(0, 27) + '...' : node.text;
    line += ` "${truncated}"`;
  }
  if (node.rect) {
    const w = Math.round(node.rect.width);
    const h = Math.round(node.rect.height);
    line += ` (${w}x${h})`;
    if (h === 0) line += ' [hidden]';
  }
  return line;
}

function printTree(node: DomNode, indent: number, maxDepth: number): string[] {
  const lines: string[] = [formatTreeLine(node, indent)];
  if (indent < maxDepth && node.children) {
    for (const child of node.children) {
      lines.push(...printTree(child, indent + 1, maxDepth));
    }
  }
  return lines;
}

export function buildSerializerScript(selector: string, depth: number, includeStyles: boolean): string {
  return `(() => {
    function serialize(el, d, maxD, styles) {
      const r = el.getBoundingClientRect();
      const node = {
        tag: el.tagName.toLowerCase(),
        rect: { width: r.width, height: r.height },
      };
      if (el.id) node.id = el.id;
      const cls = Array.from(el.classList);
      if (cls.length) node.classes = cls;
      const txt = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .filter(Boolean)
        .join(' ');
      if (txt) node.text = txt;
      const attrs = {};
      for (const a of el.attributes) {
        if (a.name !== 'id' && a.name !== 'class' && a.name !== 'style') {
          attrs[a.name] = a.value;
        }
      }
      if (Object.keys(attrs).length) node.attributes = attrs;
      if (styles) {
        const cs = window.getComputedStyle(el);
        node.styles = {
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          position: cs.position,
          overflow: cs.overflow,
        };
      }
      if (d < maxD) {
        const kids = [];
        for (const c of el.children) {
          kids.push(serialize(c, d + 1, maxD, styles));
        }
        if (kids.length) node.children = kids;
      }
      return node;
    }
    const root = document.querySelector('${selector.replace(/'/g, "\\'")}');
    if (!root) return null;
    return JSON.stringify(serialize(root, 0, ${depth}, ${includeStyles}));
  })()`;
}

export function registerDom(program: Command): void {
  const cmd = new Command('dom')
    .description('Query DOM structure from the Tauri app')
    .argument('[selector]', 'Root element to explore', 'body')
    .option('-s, --selector <css>', 'Root element to explore (alternative)')
    .option('--mode <mode>', 'Output mode: dom (default) or accessibility', 'dom')
    .option('--depth <number>', 'Max child depth', parseInt, 3)
    .option('--tree', 'Compact tree view (default)')
    .option('--styles', 'Include computed styles')
    .option('--text <pattern>', 'Find elements containing this text (case-insensitive)')
    .option('--count', 'Just output match count')
    .option('--first', 'Only return first match')
    .option('--json', 'Full structured JSON output')
    .addHelpText('after', `
Examples:
  $ tauri-agent-tools dom ".sidebar"
  $ tauri-agent-tools dom "#app" --depth 5 --json
  $ tauri-agent-tools dom --text "Submit" --first
  $ tauri-agent-tools dom body --mode accessibility`);

  addBridgeOptions(cmd);

  cmd.action(async (selectorArg: string, opts: {
    selector?: string;
    mode: string;
    depth: number;
    tree?: boolean;
    styles?: boolean;
    text?: string;
    count?: boolean;
    first?: boolean;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const mode = parseEnum(DomModeSchema, opts.mode, 'mode');
    if (opts.selector && selectorArg !== 'body' && opts.selector !== selectorArg) {
      throw new Error(
        `Conflicting selectors: positional "${selectorArg}" vs --selector "${opts.selector}". Use one or the other.`,
      );
    }
    const selector = opts.selector ?? selectorArg;
    const bridge = await resolveBridge(opts);

    // Find-by-text mode
    if (opts.text) {
      const escapedText = opts.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const textScript = `(() => {
        var root = document.querySelector('${escapedSelector}') || document.body;
        var pattern = '${escapedText}'.toLowerCase();
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var seen = new Set();
        var results = [];
        while (walker.nextNode()) {
          var textNode = walker.currentNode;
          if (textNode.textContent && textNode.textContent.toLowerCase().includes(pattern)) {
            var el = textNode.parentElement;
            if (el && !seen.has(el)) {
              seen.add(el);
              var r = el.getBoundingClientRect();
              var node = { tag: el.tagName.toLowerCase(), rect: { width: r.width, height: r.height } };
              if (el.id) node.id = el.id;
              var cls = Array.from(el.classList);
              if (cls.length) node.classes = cls;
              node.text = el.textContent.trim().substring(0, 100);
              results.push(node);
            }
          }
        }
        return JSON.stringify(results);
      })()`;
      const raw = await bridge.eval(textScript);
      const matches = z.array(DomNodeSchema).parse(JSON.parse(String(raw)));

      if (opts.count) {
        console.log(String(matches.length));
        return;
      }

      if (opts.first) {
        if (matches.length === 0) {
          throw new Error(`No elements found containing "${opts.text}"`);
        }
        if (opts.json) {
          console.log(JSON.stringify(matches[0], null, 2));
        } else {
          console.log(formatTreeLine(matches[0]!, 0));
        }
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(matches, null, 2));
      } else {
        if (matches.length === 0) {
          console.log(`No elements found containing "${opts.text}"`);
        } else {
          for (const node of matches) {
            console.log(formatTreeLine(node, 0));
          }
        }
      }
      return;
    }

    if (mode === 'accessibility') {
      const tree = await bridge.getAccessibilityTree(selector, opts.depth);
      if (!tree) {
        throw new Error(`Element not found: ${selector}`);
      }
      if (opts.json) {
        console.log(JSON.stringify(tree, null, 2));
      } else {
        const lines = printA11yTree(tree, 0, opts.depth);
        console.log(lines.join('\n'));
      }
      return;
    }

    const escaped = selector.replace(/'/g, "\\'");

    if (opts.count) {
      const js = `document.querySelectorAll('${escaped}').length`;
      const result = await bridge.eval(js);
      console.log(String(result));
      return;
    }

    if (opts.first) {
      // Return only the first match, depth 0 (just the element itself)
      const script = buildSerializerScript(selector, 0, !!opts.styles);
      const result = await bridge.eval(script);
      if (result === null || result === undefined) {
        throw new Error(`Element not found: ${selector}`);
      }
      const node = DomNodeSchema.parse(JSON.parse(String(result)));
      if (opts.json) {
        console.log(JSON.stringify(node, null, 2));
      } else {
        console.log(formatTreeLine(node, 0));
      }
      return;
    }

    const script = buildSerializerScript(selector, opts.depth, !!opts.styles);
    const result = await bridge.eval(script);

    if (result === null || result === undefined) {
      throw new Error(`Element not found: ${selector}`);
    }

    const tree = DomNodeSchema.parse(JSON.parse(String(result)));

    if (opts.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      const lines = printTree(tree, 0, opts.depth);
      console.log(lines.join('\n'));
    }
  });

  program.addCommand(cmd);
}
