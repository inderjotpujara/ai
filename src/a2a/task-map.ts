/**
 * A2A task-state bijection (Slice 31, Increment 3 — §7.1 correctness hard part).
 *
 * Pure, I/O-free mappers projecting the engine's terminal `OrchestratorResult`
 * and the queue's `JobStatus` onto A2A wire task states / artifacts / typed
 * JSON-RPC errors. Consumed by the A2A JSON-RPC server (Task 9) and the
 * fail-closed consent path (Task 13).
 *
 * Totality is the invariant: EVERY `OrchestratorResult` variant and EVERY
 * `JobStatus` member maps explicitly — there is no default-to-`completed`
 * hole. The `JobStatus` switch closes over the enum with a `never`-typed
 * default, so adding a member fails to compile until it is mapped here. A
 * `gap` / `resource` / failed status can NEVER project to `completed`.
 *
 * The failure detail rides the typed error (`resultToTaskError`) or the
 * task-status message — never the artifact. These functions never interpolate
 * untrusted result text into anything executable; they only carry it as inert
 * data.
 */

import { randomUUID } from 'node:crypto';
import {
  type A2aArtifact,
  ArtifactSchema,
  TaskStateWire,
} from '../contracts/index.ts';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import { JobStatus } from '../queue/types.ts';

/** JSON-RPC error codes for orchestrator failure kinds (A2A app-defined range). */
export const MISSING_CAPABILITY_ERROR_CODE = -32001;
export const RESOURCE_ERROR_CODE = -32002;
/** The typed error a fail-closed mid-run consent gate lands on (Task 13). */
export const CONSENT_UNAVAILABLE_ERROR_CODE = -32003;

type TaskError = { code: number; message: string; data?: unknown };

/**
 * Terminal result → wire task state: `answer` completes; a `gap` or `resource`
 * failure is `Failed` (never `Completed`).
 */
export function orchestratorResultToTaskState(
  r: OrchestratorResult,
): TaskStateWire {
  if (r.kind === 'answer') return TaskStateWire.Completed;
  return TaskStateWire.Failed;
}

/**
 * `answer` → one text-part artifact carrying `r.text`; `gap` / `resource` →
 * `undefined` (their detail rides the JSON-RPC error / task-status message).
 */
export function orchestratorResultToArtifact(
  r: OrchestratorResult,
): A2aArtifact | undefined {
  if (r.kind !== 'answer') return undefined;
  return ArtifactSchema.parse({
    artifactId: randomUUID(),
    parts: [{ kind: 'text', text: r.text }],
  });
}

/**
 * The typed JSON-RPC error for a failure result, or `undefined` for `answer`.
 * `gap` carries the missing capability as inert `data`; `resource` carries its
 * message verbatim (never as an instruction).
 */
export function resultToTaskError(
  r: OrchestratorResult,
): TaskError | undefined {
  if (r.kind === 'gap') {
    return {
      code: MISSING_CAPABILITY_ERROR_CODE,
      message: 'missing-capability',
      data: { missingCapability: r.missingCapability },
    };
  }
  if (r.kind === 'resource') {
    return { code: RESOURCE_ERROR_CODE, message: r.message };
  }
  return undefined;
}

/**
 * Queue status → wire task state, the projection `tasks/get` uses before the
 * orchestrator result is known. Exhaustive over `JobStatus`; the `never`
 * default enforces totality at compile time.
 */
export function jobStatusToTaskState(s: JobStatus): TaskStateWire {
  switch (s) {
    case JobStatus.Queued:
      return TaskStateWire.Submitted;
    case JobStatus.Running:
      return TaskStateWire.Working;
    case JobStatus.Done:
      return TaskStateWire.Completed;
    case JobStatus.Failed:
      return TaskStateWire.Failed;
    case JobStatus.Canceled:
      return TaskStateWire.Canceled;
    case JobStatus.Interrupted:
      return TaskStateWire.Failed;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

/** The fail-closed typed error when a remote task hits a mid-run consent gate. */
export function consentUnavailableError(): TaskError {
  return {
    code: CONSENT_UNAVAILABLE_ERROR_CODE,
    message: 'consent-unavailable',
  };
}
