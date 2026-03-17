import { Command } from 'commander';
import { addBridgeOptions, resolveBridge } from './shared.js';

interface DomNode {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  rect?: { width: number; height: number };
  attributes?: Record<string, string>;
  styles?: Record<string, string>;
  children?: DomNode[];
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

function buildSerializerScript(selector: string, depth: number, includeStyles: boolean): string {
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
    .option('--depth <number>', 'Max child depth', parseInt, 3)
    .option('--tree', 'Compact tree view (default)')
    .option('--styles', 'Include computed styles')
    .option('--count', 'Just output match count')
    .option('--first', 'Only return first match')
    .option('--json', 'Full structured JSON output');

  addBridgeOptions(cmd);

  cmd.action(async (selectorArg: string, opts: {
    selector?: string;
    depth: number;
    tree?: boolean;
    styles?: boolean;
    count?: boolean;
    first?: boolean;
    json?: boolean;
    port?: number;
    token?: string;
  }) => {
    const selector = opts.selector ?? selectorArg;
    const bridge = await resolveBridge(opts);

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
      const node: DomNode = JSON.parse(String(result));
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

    const tree: DomNode = JSON.parse(String(result));

    if (opts.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      const lines = printTree(tree, 0, opts.depth);
      console.log(lines.join('\n'));
    }
  });

  program.addCommand(cmd);
}
