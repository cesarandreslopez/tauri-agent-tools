import { describe, it, expect } from 'vitest';
import { buildDescendantTree, flattenTree, countDescendants } from '../../src/util/psTree.js';

const procs = [
  { pid: 1, ppid: 0, command: 'init' },
  { pid: 100, ppid: 1, command: 'app' },
  { pid: 200, ppid: 100, command: 'node sidecar.js' },
  { pid: 300, ppid: 200, command: 'mcp-server' }, // grandchild
  { pid: 250, ppid: 100, command: 'worker' },
  { pid: 999, ppid: 1, command: 'unrelated' },
];

describe('buildDescendantTree', () => {
  it('builds the descendant subtree, including grandchildren, children pid-sorted', () => {
    const tree = buildDescendantTree(procs, 100)!;
    expect(tree).not.toBeNull();
    expect(tree.pid).toBe(100);
    expect(tree.children.map((c) => c.pid)).toEqual([200, 250]);
    const sidecar = tree.children.find((c) => c.pid === 200)!;
    expect(sidecar.children.map((c) => c.pid)).toEqual([300]);
  });

  it('excludes unrelated processes', () => {
    const tree = buildDescendantTree(procs, 100)!;
    expect(flattenTree(tree).map((n) => n.pid)).not.toContain(999);
  });

  it('returns null for an absent root pid', () => {
    expect(buildDescendantTree(procs, 12345)).toBeNull();
  });

  it('counts descendants excluding the root', () => {
    expect(countDescendants(buildDescendantTree(procs, 100)!)).toBe(3);
  });

  it('is cycle-safe (does not hang on a ppid loop)', () => {
    const cyclic = [
      { pid: 1, ppid: 2, command: 'a' },
      { pid: 2, ppid: 1, command: 'b' },
    ];
    const tree = buildDescendantTree(cyclic, 1)!;
    expect(() => flattenTree(tree)).not.toThrow();
  });
});
