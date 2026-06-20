import { exec } from './exec.js';

/** A single process row from a `ps` snapshot. */
export interface PsProc {
  pid: number;
  ppid: number;
  command: string;
}

/** A node in a descendant process tree. */
export interface PsTreeNode extends PsProc {
  children: PsTreeNode[];
}

/**
 * Snapshot all running processes via `ps` (Unix only: macOS + Linux).
 * Columns are pid, ppid, and the full command line. Returns `[]` on Windows
 * (callers degrade gracefully) and never throws on parse — only the `ps`
 * invocation itself can reject.
 */
export async function snapshotProcesses(timeoutMs = 5000): Promise<PsProc[]> {
  if (process.platform === 'win32') return [];
  // `-axo pid=,ppid=,command=` works on both BSD (macOS) and procps (Linux);
  // the trailing `=` on each column suppresses the header row.
  const res = await exec('ps', ['-axo', 'pid=,ppid=,command='], { timeout: timeoutMs });
  const out: PsProc[] = [];
  for (const line of res.stdout.toString('utf-8').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: (m[3] ?? '').trim() });
  }
  return out;
}

/**
 * Build the descendant subtree rooted at `rootPid` from a flat process list.
 * Returns null if `rootPid` is absent from the snapshot. Cycle-safe: a node is
 * never visited twice, so pid-reuse anomalies can't cause infinite recursion.
 * Children are sorted by pid for deterministic output.
 */
export function buildDescendantTree(procs: PsProc[], rootPid: number): PsTreeNode | null {
  const byPid = new Map<number, PsTreeNode>();
  for (const p of procs) byPid.set(p.pid, { ...p, children: [] });

  for (const node of byPid.values()) {
    if (node.ppid === node.pid) continue; // guard self-parenting
    const parent = byPid.get(node.ppid);
    if (parent) parent.children.push(node);
  }

  const root = byPid.get(rootPid);
  if (!root) return null;

  const seen = new Set<number>();
  const sortRec = (n: PsTreeNode): void => {
    if (seen.has(n.pid)) {
      n.children = [];
      return;
    }
    seen.add(n.pid);
    n.children.sort((a, b) => a.pid - b.pid);
    for (const c of n.children) sortRec(c);
  };
  sortRec(root);
  return root;
}

/** Flatten a tree depth-first (root first). Cycle-safe. */
export function flattenTree(root: PsTreeNode): PsTreeNode[] {
  const out: PsTreeNode[] = [];
  const seen = new Set<number>();
  const walk = (n: PsTreeNode): void => {
    if (seen.has(n.pid)) return;
    seen.add(n.pid);
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Number of descendants of `root` (the root itself excluded). */
export function countDescendants(root: PsTreeNode): number {
  return Math.max(0, flattenTree(root).length - 1);
}
