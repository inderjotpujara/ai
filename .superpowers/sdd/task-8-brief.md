### Task 8: task-map.ts — the OrchestratorResult/JobStatus ↔ task-state bijection (HARD §7.1)

**Files:**
- Create: `src/a2a/task-map.ts`
- Test: `tests/a2a/task-map.test.ts`

**Interfaces:**
- Consumes: `OrchestratorResult` from `../core/orchestrator.ts`; `JobStatus` from `../queue/types.ts`; `TaskStateWire`, `A2aTask`, `A2aArtifact`, `JsonRpcErrorSchema` from `../contracts/index.ts`.
- Produces:
  - `orchestratorResultToTaskState(r: OrchestratorResult): TaskStateWire` — `answer→Completed`, `gap→Failed`, `resource→Failed` (per the D3 table).
  - `orchestratorResultToArtifact(r: OrchestratorResult): A2aArtifact | undefined` — for `answer`, one text-part artifact carrying `r.text`; for `gap`/`resource`, `undefined` (the failure detail rides the JSON-RPC error / task-status message).
  - `resultToTaskError(r: OrchestratorResult): { code: number; message: string; data?: unknown } | undefined` — `gap → { code: -32001, message: 'missing-capability', data: { missingCapability } }`, `resource → { code: -32002, message: r.message }`, `answer → undefined`.
  - `jobStatusToTaskState(s: JobStatus): TaskStateWire` — `Queued→Submitted`, `Running→Working`, `Done→Completed`, `Failed→Failed`, `Canceled→Canceled`, `Interrupted→Failed` (the projection `tasks/get` uses before the orchestrator result is known).
  - `CONSENT_UNAVAILABLE_ERROR_CODE = -32003` + `consentUnavailableError(): { code; message: 'consent-unavailable'; data? }` — the typed error a **fail-closed** mid-run consent gate lands on (a remote A2A task runs as a queued job whose dispatch hardcodes `confirm: async () => false`, `src/server/jobs/dispatch.ts:200`, so a consent gate declines → the job goes `Failed`). Reused by Task 13's `Failed→failed` + typed-`consent-unavailable` mapping. (`TaskStateWire.InputRequired` stays in the enum for protocol completeness but is **never emitted** this slice — there is no live client / promptId round-trip substrate.)

- [ ] **Step 1: Write the failing tests** — every `OrchestratorResult` variant maps to the spec-table state; the `JobStatus` projection is total:

```ts
import { expect, test } from 'bun:test';
import { JobStatus } from '../../src/queue/types.ts';
import { TaskStateWire } from '../../src/contracts/index.ts';
import {
  jobStatusToTaskState,
  orchestratorResultToArtifact,
  orchestratorResultToTaskState,
  resultToTaskError,
} from '../../src/a2a/task-map.ts';

test('answer → completed with a text artifact', () => {
  const r = { kind: 'answer', text: 'done' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Completed);
  expect(orchestratorResultToArtifact(r)?.parts[0]).toMatchObject({ kind: 'text', text: 'done' });
  expect(resultToTaskError(r)).toBeUndefined();
});
test('gap → failed + missing-capability error', () => {
  const r = { kind: 'gap', missingCapability: 'ocr', message: 'no ocr' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Failed);
  expect(resultToTaskError(r)).toMatchObject({ message: 'missing-capability' });
});
test('resource → failed + resource error', () => {
  const r = { kind: 'resource', message: 'oom' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Failed);
  expect(resultToTaskError(r)?.code).toBe(-32002);
});
test('jobStatus projection covers every queue status', () => {
  expect(jobStatusToTaskState(JobStatus.Queued)).toBe(TaskStateWire.Submitted);
  expect(jobStatusToTaskState(JobStatus.Running)).toBe(TaskStateWire.Working);
  expect(jobStatusToTaskState(JobStatus.Interrupted)).toBe(TaskStateWire.Failed);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — pure switch functions; no I/O. Use early returns; the `JobStatus` switch is exhaustive over the enum.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/task-map.ts tests/a2a/task-map.test.ts`.

```bash
git add src/a2a/task-map.ts tests/a2a/task-map.test.ts
git commit -m "feat(a2a): OrchestratorResult/JobStatus ↔ A2A task-state bijection"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.1 task-state mapping).** Reviewer probes: is every `OrchestratorResult` and `JobStatus` variant mapped (no default-to-completed hole)? Does a `gap`/`resource` NEVER project to `completed`? Is the failure detail carried without leaking untrusted text as an instruction?*

