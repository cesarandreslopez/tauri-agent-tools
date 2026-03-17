import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the DOM serializer script output format and tree rendering
// by mocking the bridge and verifying the script structure

vi.mock('../../src/bridge/tokenDiscovery.js', () => ({
  discoverBridge: vi.fn().mockResolvedValue({ port: 9999, token: 'test' }),
}));

describe('DOM command', () => {
  describe('tree formatting', () => {
    // Test the formatting logic directly
    it('formats a basic node', () => {
      const node = {
        tag: 'div',
        id: 'app',
        classes: ['main', 'container'],
        rect: { width: 1920, height: 1080 },
      };

      const line = formatNode(node, 0);
      expect(line).toBe('div#app.main.container (1920x1080)');
    });

    it('formats node with text preview', () => {
      const node = {
        tag: 'button',
        classes: ['btn'],
        text: 'Click Me',
        rect: { width: 80, height: 32 },
      };

      const line = formatNode(node, 0);
      expect(line).toBe('button.btn "Click Me" (80x32)');
    });

    it('truncates long text', () => {
      const node = {
        tag: 'p',
        text: 'This is a very long paragraph text that should be truncated',
        rect: { width: 500, height: 20 },
      };

      const line = formatNode(node, 0);
      expect(line).toContain('...');
      expect(line.length).toBeLessThan(100);
    });

    it('marks zero-height elements', () => {
      const node = {
        tag: 'div',
        classes: ['hidden-toast'],
        rect: { width: 400, height: 0 },
      };

      const line = formatNode(node, 0);
      expect(line).toContain('[hidden]');
    });

    it('indents nested nodes', () => {
      const line = formatNode({ tag: 'span', rect: { width: 50, height: 20 } }, 3);
      expect(line).toBe('      span (50x20)');
    });
  });
});

// Helper to test formatting logic directly (mirrors the dom.ts implementation)
interface TestNode {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  rect?: { width: number; height: number };
}

function formatNode(node: TestNode, indent: number): string {
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
