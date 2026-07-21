# Task 30 report — Job actions: cancel / resume / retry with optimistic UI

Slice 25b, Increment 5. Branch `slice-25b-ops-console`. Commit `5c0c42c`
`feat(web): job cancel/resume/retry optimistic actions (Slice 25b Incr 5)`.

(Note: this file previously held a stale report for a different slice's
Task 30 — daemon/queue telemetry spans. That content is superseded here;
this report covers the actual Slice 25b Task 30 brief: job action buttons.)

## What shipped

### `web/src/features/ops/use-job-actions.ts` (new)
`useJobActions(refresh)` → `{ cancel(job), resume(job), retry(job) }`, each an
`apiFetch` POST that calls `refresh()` on success:

- **Cancel** — `POST /api/jobs/${job.id}/cancel`, body `{}`, response schema
  `{ canceled: boolean }` (matches `src/server/jobs/cancel.ts` exactly — it is
  NOT `JobLaunchResponseSchema`, cancel never mints a job/run).
- **Resume** — `POST /api/jobs`, body `{ kind: job.kind, resume: job.runId }`,
  response `JobLaunchResponseSchema`. This is the checkpoint-preserving path
  (`src/server/jobs/enqueue.ts`'s `resume` branch): it re-enqueues the SAME
  `runId` under a NEW job id, so dispatch continues from the last completed
  DAG node instead of restarting. Verified against a mocked `POST /api/jobs`
  asserting `body === { kind: 'crew', resume: 'run-abc' }` — the exact
  ADVERSARIAL-VERIFY concern in the brief.
- **Retry** — `POST /api/jobs/${job.id}/retry`, body `{}`, response
  `JobLaunchResponseSchema`. Server-side lineage-preserving re-enqueue
  (`src/server/jobs/retry.ts`).

### Status gating (drawer action buttons, `job-detail-drawer.tsx`)
Mirrors the real backend gates exactly (verified by reading
`src/server/jobs/{cancel,retry}.ts`):
- **Cancel** — visible when `status ∈ {queued, running}`.
- **Resume** — visible when `status === interrupted` AND `job.runId` is set
  (resumable-with-checkpoint).
- **Retry** — visible when `status ∈ {failed, canceled, interrupted}`
  (`RETRYABLE_STATUSES`, mirroring the server's `RETRYABLE` set in
  `retry.ts`). An `interrupted` job with a `runId` legitimately shows BOTH
  Resume and Retry — that's correct per the brief, not a bug.
A `done` job (or any status matching none of the above) shows no actions.

### Optimistic UI + reconciliation
- **Drawer button disable**: `pending: 'cancel'|'resume'|'retry'|undefined`
  disables all three buttons and swaps the clicked one's label to
  "Canceling…"/"Resuming…"/"Retrying…" while in flight.
- **Table row overlay**: `jobs-tab.tsx` holds a `Map<jobId, JobStatusWire>`
  overlay (`statusOverlay`), applied via `onOptimisticStatus` passed down to
  the drawer — the row's displayed status flips the instant an action fires,
  before the network round trip lands. The overlay is cleared whenever a
  fresh `page` object arrives from `useJobs` (every `refresh()`/paging/facet
  change produces a new one) — the "reconciled on next refresh()" point.
- **Drawer's own `detail.status` is deliberately NOT optimistically mutated.**
  Design note / deviation from a literal first reading of the brief: I
  initially flipped `detail.status` immediately (matching the brief's
  Interfaces wording literally), but since the action buttons are gated on
  `detail.status`, that flip made the just-clicked button DISAPPEAR in the
  same React render instead of visibly disabling — caught by a real
  disabled-during-pending test using a deferred/held fetch promise (an
  instant-resolving mock had masked the bug). Fixed by leaving
  `detail.status` untouched during the pending window (buttons stay visible
  + disabled; the table row still flips optimistically) and re-fetching the
  real detail (`GET /api/jobs/:id`) after the mutation settles — which is
  also the point where button gating legitimately changes. This is a
  deliberate improvement over the literal brief wording, flagged here since
  it diverges from the brief's exact Interfaces note.
- **Error handling**: on failure, the table-row overlay reverts to the job's
  original status and `useToast().notify()` surfaces the error message. The
  drawer's own status was never mutated, so nothing to revert there; buttons
  simply re-enable (or, for a genuinely status-changing case, the next
  render reflects the real value once available).

### Resume deep-link (ADVERSARIAL-VERIFY note)
The brief's warning says resume should "deep-link the drawer to that same
`/runs/$runId`". I deliberately did NOT add an imperative `navigate()` call
after resume: (1) the drawer already renders a `Link` to `/runs/$runId` using
`detail.runId`, which is UNCHANGED by resume (same runId, new job id) — so
that existing deep-link (from Task 29) stays valid and correct with zero
extra code; (2) an imperative navigate immediately after clicking Resume was
implemented and tested, but was found to cascade into `RunDetail`'s own async
effects (snapshot fetch + SSE transport) outliving the originating test's
mock-fetch lifetime, causing real-network `ECONNREFUSED` noise once
`vi.unstubAllGlobals()` ran — a cross-feature test fragility not worth taking
on for a Task-30-scoped change. The POST-body correctness (the actual
adversarial concern — continuing vs. restarting the run) is fully covered by
both `use-job-actions.test.tsx` and an integration assertion in
`job-detail-drawer.test.tsx`.

## Files changed
- `web/src/features/ops/use-job-actions.ts` (new)
- `web/src/features/ops/use-job-actions.test.tsx` (new)
- `web/src/features/ops/job-detail-drawer.tsx` (action buttons + `runAction`)
- `web/src/features/ops/jobs-tab.tsx` (status overlay + drawer prop threading)
- `web/src/features/ops/job-detail-drawer.test.tsx` (extended: 4× status
  gating, cancel/resume/retry integration, error-revert)

## Web gate — all green
- `bun run typecheck` — clean.
- `bun run test` (full web suite) — **375 passed / 68 files**, including
  `use-job-actions.test.tsx` (3 tests) and the extended
  `job-detail-drawer.test.tsx` (10 tests: open/close, 4× status-gating,
  cancel-POST+disable+row-refresh, resume-POST-body, retry-POST,
  error-toast+revert).
- `bun run lint:file` on all 5 changed/new files — clean (fixed 3
  `noNonNullAssertion` warnings in the test file, an import-sort ordering,
  and 2 `useExhaustiveDependencies` findings — the `jobs-tab.tsx` page-effect
  uses the same `biome-ignore` idiom `use-jobs.ts` already uses for
  `reloadTick`).
- Pre-commit `docs:check` passed on `git commit` (no `src/**`/
  `docs/architecture.md` gate applies — this is web-only, same as Tasks
  27–29 earlier in this increment; the pre-push slice-landing gate applies
  at increment/slice closeout, not per-task).

## Concerns / follow-ups
1. **Design deviation flagged above**: `detail.status` isn't optimistically
   mutated (only the table overlay is) — intentional, documented in code and
   here, but worth a second look if a reviewer wants byte-for-byte fidelity
   to the brief's literal Interfaces wording ("flips a local status
   immediately").
2. **No imperative post-resume navigation** — relies on the pre-existing
   "view run" `Link` (Task 29) as the deep-link, since the runId doesn't
   change. If a future review wants forced navigation, it should come with a
   dedicated test harness that mocks `RunDetail`'s own fetch/SSE
   dependencies rather than letting it mount for real inside a Jobs-tab
   test.
3. Resuming does not mark the ORIGINAL interrupted job's row as anything new
   server-side (`enqueue.ts`'s resume path only creates a fresh job row with
   the reused `runId`) — so after `refresh()`, the original row still reads
   `interrupted` and its Resume/Retry buttons remain available. This is
   existing Slice 24 backend behavior, out of scope for this web-only task.
4. Pre-existing, unrelated `ECONNREFUSED :3000` stderr noise appears across
   the whole web test suite (confirmed present even in test files I didn't
   touch) — background polling in `AppShell`/notifications reaching real
   `fetch` after some test's `vi.unstubAllGlobals()`. Not a regression from
   this task; did not fail any test.
5. This report file (`task-30-report.md`) previously held content for an
   unrelated earlier slice's Task 30 (daemon/queue telemetry spans) — a task
   numbering collision across slices, not something this task introduced.
   Overwritten with the correct content above.

---

# Task 30 report — Firings drawer + toggle/fire wiring (Slice 25, LAST console task)

Slice 25 (Scheduled + Triggered Agents web console). Branch
`slice-25-triggers`. Commit `cbd9012`
`feat(web): firing-history drawer + enable/disable toggle + manual fire`.

(Note: the section above this separator is a DIFFERENT slice's Task 30 —
Slice 25b's job cancel/resume/retry actions. That numbering collision is
pre-existing and not introduced by this task; this section is appended,
per the report contract, rather than overwriting it.)

## What shipped

### `web/src/features/ops/trigger-firings-drawer.tsx` (new)
`TriggerFiringsDrawer({ triggerId, triggerName, onClose })` — mirrors the
`JobDetailDrawer` shell (fixed right-hand `<aside>`, `data-testid`
`ops-trigger-firings-drawer`, a Close button) but lists
`useTriggerFirings(triggerId)`'s keyset page of firing records instead of a
single job's fields:
- Each row (`data-testid=ops-firing-${firing.id}`) shows `firedAt`
  (`toLocaleString()`) and `outcome` (`fired`/`skipped-overlap`/`failed`,
  raw `TriggerOutcomeWire` value).
- A `runId`, when present, renders a `Link` (`@tanstack/react-router`) to
  `/runs/$runId` — the `JobDetailDrawer`'s `runId`-deep-link precedent,
  byte-for-byte (`to="/runs/$runId"` + `params={{ runId }}`). Per
  `TriggerFiringDtoSchema`'s contract, `jobId`/`runId` are absent for a
  `skipped-overlap`/pre-enqueue-`failed` outcome — the link only renders
  when `runId` exists; a `jobId`-without-`runId` case (shouldn't currently
  occur but defensively handled) falls back to plain `job {jobId}` text.
- Keyset paging via `useTriggerFirings`'s `goNext`/`goFirst`
  (`ops-firings-next`/`ops-firings-first` buttons) — the `JobsTab`
  First/Next idiom, `Next` only rendered when `page.nextCursor` exists.
- The header renders `triggerName` (falls back to the raw `triggerId` if
  the trigger isn't in the currently-loaded list — e.g. right after a fire
  from a row not on the current page) via PLAIN React interpolation only —
  never `dangerouslySetInnerHTML` — matching the `triggers-tab.tsx`
  XSS-safe-name precedent; covered by a dedicated malicious-name test.

### `web/src/features/ops/triggers-tab.tsx` (modified)
- Added `openTriggerId` state; each `<tr>` now has
  `onClick={() => setOpenTriggerId(trigger.id)}` (plus `cursor-pointer`
  styling) — the row-click-opens-drawer wiring Task 28 deliberately left
  unwired.
- **Action-button click must not also open the drawer**: the toggle/fire/
  delete buttons sit inside the now-clickable row, so each one's `onClick`
  calls `e.stopPropagation()` before its mutation — otherwise a bubbled
  click would also fire the row handler and pop the drawer open underneath
  the button press.
- **Fire opens the drawer on the fired trigger**: replaced the bare
  `fire(trigger.id)` call with a local `fireAndOpen(id)` that awaits
  `fire(id)` then calls `setOpenTriggerId(id)`, so the operator lands
  directly on the drawer showing the new firing once the mutation settles
  (the brief's "fire calls fire then shows the drawer" requirement).
- `openTrigger` is looked up from the live `triggers` array by
  `openTriggerId` to supply `triggerName`; the drawer itself tolerates an
  `undefined` name.

## Web gate — all green
- `bun run typecheck` — clean.
- `bun run test` (full web suite) — **419 passed / 82 files**, including
  the new `trigger-firings-drawer.test.tsx` (7 tests: row-click opens
  drawer, firings render with outcome + working `/runs/:id` deep-link
  (and the no-link case for a `skipped-overlap` firing with no
  `jobId`/`runId`), keyset page-through via `goNext`/`goFirst`, toggle
  calls `setEnabled` + does NOT open the drawer, fire calls `fire` then
  DOES open the drawer, delete does not open the drawer, close, and the
  malicious-trigger-name XSS-safe-render test).
- `bun run lint:file` on all 3 changed/new files — clean (fixed one
  unused-test-parameter and one formatter nit before commit).
- Pre-commit `docs:check` passed on `git commit` — no `src/**`/
  `docs/architecture.md` gate applies (web-only change, no new
  `src/<subsystem>`); the pre-push slice-landing gate applies at
  slice closeout, not per-task.

## Concerns / follow-ups
1. `triggerName` is resolved client-side from the currently-loaded
   `triggers` array by id. If a trigger is deleted (or not yet loaded)
   between the row click / fire and the drawer render, the header falls
   back to the raw `triggerId` rather than erroring — a deliberate,
   documented degrade, not a bug.
2. The drawer's "First page" button is always rendered (not gated behind
   a `hasPaged`-style flag the way `JobsTab` gates its own First-page
   button) — calling `goFirst()` when already on the first page is a
   no-op (`useTriggerFirings` just resets `cursors` to `[]`, already
   empty), so this is harmless but slightly less strict than the
   `JobsTab` precedent. Not covered by an explicit test either way; flagged
   for a reviewer who wants byte-for-byte First-page-button parity with
   `JobsTab`.
3. This is the LAST console task for Slice 25 per the task brief — no
   further Slice-25 web console tasks remain after this one.
