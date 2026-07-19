import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

type CheckpointFile = {
  completed: string[];
  nodeResults: Record<string, unknown>;
};

/** The per-run checkpoint handle the DAG loop drives: `completed()` at start to
 *  skip finished nodes, `record()` after each node, `resultOf()` to read a
 *  skipped upstream node's output when seeding a resumed run. */
export type CheckpointStore = {
  completed(): Set<string>;
  record(nodeId: string, result: unknown): void;
  resultOf(nodeId: string): unknown;
};

/**
 * Per-run DAG-node checkpoint (D5 fallback). Backs a single JSON file at
 * `runs/<id>/checkpoint.json`: the DAG loop calls `completed()` at start to skip
 * finished nodes and `record(nodeId, result)` after each node, so a re-enqueue
 * of the same runId resumes at the first incomplete node with NO re-execution.
 */
export function createCheckpointStore(runDir: string): CheckpointStore {
  const path = join(runDir, 'checkpoint.json');
  const state: CheckpointFile = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as CheckpointFile)
    : { completed: [], nodeResults: {} };

  function persist(): void {
    mkdirSync(dirname(path), { recursive: true });
    // Atomic write: temp then rename, so a crash mid-write never leaves a
    // half-written checkpoint (which would corrupt resume — the whole point).
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, path);
  }

  return {
    completed: (): Set<string> => new Set(state.completed),
    record(nodeId: string, result: unknown): void {
      if (!state.completed.includes(nodeId)) state.completed.push(nodeId);
      state.nodeResults[nodeId] = result;
      persist();
    },
    resultOf: (nodeId: string): unknown => state.nodeResults[nodeId],
  };
}
