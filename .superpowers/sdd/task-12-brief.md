### Task 12: stream.ts — re-frame the run-stream as A2A SSE events

**Files:**
- Create: `src/a2a/stream.ts`, `src/server/a2a/stream-route.ts`
- Modify: `src/server/a2a/rpc.ts` (detect `message/stream` / `tasks/resubscribe` → delegate to the stream route)
- Test: `tests/a2a/stream.test.ts`, `tests/server/a2a-stream-route.test.ts`

**Interfaces:**
- Consumes: `handleRunStream`, `RunStreamOpts` from `../../server/runs/stream.ts`; `SpanDTO`, `RunLifecycle` from `../contracts/index.ts`; `jobStatusToTaskState`, `orchestratorResultToArtifact` (Task 8); `A2aServerDeps` (Task 9).
- Produces:
  - `src/a2a/stream.ts`: `frameRunSpanAsA2a(span: SpanDTO, ctx: { taskId: string; contextId: string }): string | undefined` — maps a run span to a `TaskStatusUpdateEvent` (state transition `submitted→working→completed/failed`) or a `TaskArtifactUpdateEvent` (text/data artifact) as an SSE `data:` frame keyed by the span's wire id (so `Last-Event-ID` replay works); a span with no A2A meaning returns `undefined` (skipped). Pure, unit-testable.
  - `src/server/a2a/stream-route.ts`: `handleA2aStream(params: unknown, method: A2aMethod, req: Request, deps: A2aServerDeps): Promise<Response>` — for `message/stream`: enqueue (reuse `handleMessageSend`), then open a `text/event-stream` that **delegates to `handleRunStream`** for the run and pipes each frame through `frameRunSpanAsA2a` (ONE SSE engine, two framings — never a parallel stream). For `tasks/resubscribe`: resolve the running task's runId and re-attach via `handleRunStream` with `Last-Event-ID` replay (`RunStreamOpts.lastEventId`).

- [ ] **Step 1: Write the failing tests** (fake span sequence):

```ts
test('frameRunSpanAsA2a maps run lifecycle spans to TaskStatusUpdate submitted→working→completed', () => { /* feed spans, assert the 3 status frames */ });
test('an answer span becomes a TaskArtifactUpdate with a text part', () => { /* ... */ });
test('message/stream emits status then an artifact then completed (re-framing handleRunStream)', async () => { /* inject a fake run producing spans; assert A2A frame sequence */ });
test('tasks/resubscribe replays by Last-Event-ID (only newer frames)', async () => { /* set Last-Event-ID; assert seeded replay */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Route `message/stream`/`tasks/resubscribe` from `rpc.ts` to `handleA2aStream` (they return an SSE Response, not a JSON-RPC body).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/stream.ts src/server/a2a/stream-route.ts src/server/a2a/rpc.ts tests/a2a/stream.test.ts tests/server/a2a-stream-route.test.ts`.

```bash
git add src/a2a/stream.ts src/server/a2a/stream-route.ts src/server/a2a/rpc.ts tests/a2a/stream.test.ts tests/server/a2a-stream-route.test.ts
git commit -m "feat(a2a): message/stream + tasks/resubscribe re-framing the run-stream as A2A SSE"
```

*Model: Opus (SSE re-framing correctness — the Last-Event-ID replay contract must survive across the A2A framing; a lost terminal frame is the §7.1-adjacent reconnect gap).*

