/** Minimal shape needed to merge: an ISO-ish timestamp string. */
export interface HasTs {
  ts: string;
}

/**
 * Stable-merge multiple log arrays into one ascending-by-timestamp stream.
 *
 * Entries whose `ts` is unparseable sort after all parseable entries (treated
 * as +∞) but keep their relative input order. Stability is guaranteed via an
 * insertion-order tiebreaker, so two entries with the same millisecond — or two
 * unparseable entries — keep a deterministic, source-interleaved order.
 *
 * A flat stable sort (rather than a k-way heap) is intentional: the inputs here
 * are bounded (a ring buffer of ≤1000 plus a handful of log files), so O(n log n)
 * on the merged set is simpler and just as fast, with no per-source pre-sort
 * requirement.
 */
export function mergeByTimestamp<T extends HasTs>(sources: T[][]): T[] {
  const tagged: Array<{ item: T; key: number; order: number }> = [];
  let order = 0;
  for (const src of sources) {
    for (const item of src) {
      const parsed = Date.parse(item.ts);
      tagged.push({
        item,
        key: Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed,
        order: order++,
      });
    }
  }
  tagged.sort((a, b) => a.key - b.key || a.order - b.order);
  return tagged.map((t) => t.item);
}
