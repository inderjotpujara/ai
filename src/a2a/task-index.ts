import { loadConfig } from '../config/schema.ts';

/**
 * A2A task identity index (Slice 31, Task 9).
 *
 * The A2A `taskId` IS the queue `jobId` (1:1). Durable identity therefore lives
 * in the job store — a `taskId` is resolvable to its job after a restart with
 * NO help from this map (the taskId literally equals the jobId). What is NOT in
 * the job store is the A2A `contextId` (the multi-turn conversation grouping),
 * so this tiny in-memory bidirectional map caches the `taskId → jobId` binding
 * and the `contextId` for each bound task, falling back to the durable identity
 * (and to the taskId itself as a self-context) when the process was restarted
 * and the cache is cold.
 *
 * BOUNDED (§7.3 memory guard): a long-lived daemon fielding many remote tasks
 * must not grow these maps without limit. `maxEntries` is a hard cap sized by a
 * config knob (`AGENT_A2A_MAX_TASK_INDEX`, env-fallback only — NOT a hardcode);
 * once a new binding crosses it, the OLDEST binding is evicted from both maps
 * (Map insertion order → O(1) eviction, mirroring the replay-guard's cap). An
 * evicted task loses only its cache entry: identity still resolves via
 * `taskId === jobId` from the durable job store, and its contextId falls back to
 * the taskId — so eviction is safe, never a correctness loss.
 */

export function createTaskIndex(
  maxEntries = Number(loadConfig().values.AGENT_A2A_MAX_TASK_INDEX),
): {
  taskIdForJob(jobId: string): string;
  jobIdForTask(taskId: string): string | undefined;
  contextFor(taskId: string): string;
  bind(taskId: string, jobId: string, contextId: string): void;
} {
  const jobByTask = new Map<string, string>();
  const contextByTask = new Map<string, string>();
  return {
    /** The A2A taskId exposed for a jobId. Identity is 1:1, so the taskId IS
     *  the jobId. */
    taskIdForJob(jobId: string): string {
      return jobId;
    },
    /** The jobId a taskId maps to. The cache is consulted first (so a future
     *  non-identity binding would still resolve), then we fall back to the
     *  durable identity `taskId === jobId` — so a task bound before a restart
     *  (present in the durable job store, absent from this fresh map) still
     *  resolves. Whether that jobId names a REAL job is the caller's
     *  `jobStore.getJob` check, not this map's. */
    jobIdForTask(taskId: string): string | undefined {
      return jobByTask.get(taskId) ?? taskId;
    },
    /** The conversation grouping for a taskId; falls back to the taskId itself
     *  (a task is its own context) when the cache is cold. */
    contextFor(taskId: string): string {
      return contextByTask.get(taskId) ?? taskId;
    },
    bind(taskId: string, jobId: string, contextId: string): void {
      // Re-binding an existing taskId is an update (Map.set on an existing key
      // preserves its insertion position and does not grow size), so it never
      // pushes the map over the cap on its own.
      jobByTask.set(taskId, jobId);
      contextByTask.set(taskId, contextId);
      // Hard cap: once a NEW binding crosses `maxEntries`, evict the oldest from
      // BOTH maps together (same insertion-ordered key). Identity + context both
      // fall back safely for an evicted task, so this is memory-only.
      while (jobByTask.size > maxEntries) {
        const oldest = jobByTask.keys().next().value;
        if (oldest === undefined) break;
        jobByTask.delete(oldest);
        contextByTask.delete(oldest);
      }
    },
  };
}
