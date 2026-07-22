### Task 9: server.ts — JSON-RPC dispatch (message/send, tasks/get, tasks/cancel) (HARD §7.2 + §7.4)

**Files:**
- Create: `src/a2a/server.ts`, `src/a2a/task-index.ts`
- Test: `tests/a2a/server.test.ts`

**Interfaces:**
- Consumes: `A2aAllowlist` (Task 4); `task-map.ts` (Task 8); `JobStore`, `JobKind` from `../queue/`; `RunOrigin` from `../contracts/index.ts`; `newRunId` from `../run/run-id.ts`; `createRun` from `../run/run-store.ts`; `MessageSchema`, `A2aTask`, `TaskStateWire`, `A2aMethod`, `JsonRpcRequestSchema` from `../contracts/index.ts`; `withA2aServerTaskSpan` (Task 2).
- Produces:
  - `src/a2a/task-index.ts`: `createTaskIndex(): { taskIdForJob(jobId): string; jobIdForTask(taskId): string | undefined; contextFor(taskId): string; bind(taskId, jobId, contextId): void }` — the A2A `taskId` IS the queue `jobId` (1:1); `contextId` groups a multi-turn conversation. A tiny in-memory bidirectional map seeded from the queue (durable identity = the jobId; the map only caches contextId grouping).
  - `src/a2a/server.ts`:

```ts
export type A2aServerDeps = {
  allowlist: A2aAllowlist;
  jobStore: JobStore;
  runsRoot: string;
  taskIndex: ReturnType<typeof createTaskIndex>;
};
export type A2aRpcResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number; message: string; data?: unknown } };
export function handleMessageSend(params: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
export function handleTasksGet(params: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
export function handleTasksCancel(params: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
/** Pure JSON-RPC dispatcher over the three (non-streaming) methods; streaming
 *  methods are handled at the route (Task 12). Unknown method → -32601. */
export function dispatchA2aRpc(rpc: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
```

  Flow for `message/send`: `MessageSchema.parse(params.message)` (400/-32602 on bad shape); **the skillId comes from `params.metadata.skillId` (or a `data` part) and is resolved via `deps.allowlist.resolve(skillId)` — an unlisted/absent skill → `{ ok:false, error:{ code:-32004, message:'skill not allowed' } }` BEFORE any enqueue (resolve-then-reject, §7.4; never reaches a model)**; build the job payload from `message.parts` **treated as UNTRUSTED** — extract text via a delimited untrusted-transcript wrapper (reuse the existing delimited-untrusted handling; never let inbound text act as orchestrator instructions, §7.2); pre-mint `runId` + `createRun`; `deps.jobStore.enqueue({ kind: target.kind, payload: { ...built, a2aRef: target.ref }, origin: RunOrigin.Remote, runId })`; `deps.taskIndex.bind(job.id, job.id, contextId)`; return `A2aTask { id: job.id, contextId, status: { state: Submitted }, artifacts: [], history: [message], kind: 'task' }`. Wrap in `withA2aServerTaskSpan({ method, skillId })`. `tasks/get`: `jobIdForTask` → `jobStore.getJob` → project via `jobStatusToTaskState` (+ artifact from the job result when Done). `tasks/cancel`: fire the existing job cancel (`jobStore` cancel path / AbortSignal) → task `Canceled`.

- [ ] **Step 1: Write the failing tests** (fake `JobStore`):

```ts
test('message/send to a listed skill enqueues origin=Remote and returns a submitted Task', async () => { /* allowlist.put(ask→file_qa); resolve; assert enqueue called with origin=Remote + kind, task.status.state==='submitted' */ });
test('message/send to an UNLISTED skill rejects pre-enqueue (§7.4, no job)', async () => { /* skillId 'ghost' → error code -32004, enqueue spy NOT called */ });
test('inbound message parts are wrapped as UNTRUSTED in the payload (§7.2)', async () => { /* payload text is delimited/quoted, not spliced as an instruction */ });
test('tasks/get projects the job status to a task state', async () => { /* fake job Running → task working */ });
test('tasks/cancel fires the job cancel → canceled', async () => { /* assert cancel called, state canceled */ });
test('unknown method → -32601', async () => { /* dispatchA2aRpc({method:'foo'}) */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Mirror `handleJobEnqueue` (`src/server/jobs/enqueue.ts:71`) for the pre-mint-run + enqueue shape.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/server.ts src/a2a/task-index.ts tests/a2a/server.test.ts`.

```bash
git add src/a2a/server.ts src/a2a/task-index.ts tests/a2a/server.test.ts
git commit -m "feat(a2a): JSON-RPC server (message/send→enqueue, tasks/get, tasks/cancel)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.2 untrusted-content + §7.4 invoke-time resolve-then-reject).** Reviewer probes: is the allowlist resolve genuinely BEFORE any enqueue (no fall-through to a generic run)? Are inbound parts provably UNTRUSTED (delimited, never instructions)? Does the taskId↔jobId identity hold across get/cancel?*

