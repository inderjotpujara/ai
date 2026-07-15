import type { DagModel } from './types.ts';

const RANK_SPACING_X = 220;
const NODE_SPACING_Y = 90;

/**
 * Deterministic layered layout: each node's rank = the length of the longest
 * path from any root (a node with no incoming edge) to it, found by relaxing
 * `rank[to] = max(rank[to], rank[from] + 1)` over every edge, repeated once
 * per node (a safe upper bound for a DAG with `nodes.length` nodes and no
 * cycles — the deepest possible chain is `nodes.length - 1` hops). Nodes
 * within a rank are laid out in model order. `x = rank * spacing`,
 * `y = indexWithinRank * spacing`. Unreachable/disconnected nodes rank 0.
 */
export function layeredPositions(
  model: DagModel,
): Map<string, { x: number; y: number }> {
  const ranks = new Map<string, number>();
  for (const node of model.nodes) ranks.set(node.id, 0);

  for (let i = 0; i < model.nodes.length; i++) {
    for (const edge of model.edges) {
      const fromRank = ranks.get(edge.from);
      const toRank = ranks.get(edge.to);
      if (fromRank === undefined || toRank === undefined) continue;
      if (fromRank + 1 > toRank) ranks.set(edge.to, fromRank + 1);
    }
  }

  const byRank = new Map<number, string[]>();
  for (const node of model.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const bucket = byRank.get(rank) ?? [];
    bucket.push(node.id);
    byRank.set(rank, bucket);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, ids] of byRank) {
    ids.forEach((id, index) => {
      positions.set(id, {
        x: rank * RANK_SPACING_X,
        y: index * NODE_SPACING_Y,
      });
    });
  }
  return positions;
}
