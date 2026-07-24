# Task 17 report — repo Cron sweep + JobChain pull trigger defs

**Slice 32 (self-improvement loop). Branch `slice-32-self-improvement`.**

(Note: this file previously held a Slice-31 Task 17 report — same filename,
different slice; overwritten for the current Slice-32 Task 17.)

## Summary

Added two repo-registered `TriggerDef` entries to the empty `TRIGGERS`
registry in repo-root `triggers/index.ts`, exactly matching the shapes in the
task brief (`.superpowers/sdd/task-17-brief.md`). No new `TriggerType` — both
ride the existing `TriggerType.Cron` / `TriggerType.JobChain` substrate. No
engine change needed: `syncRepoTriggers` (`src/triggers/sync.ts`, called from
`engine.ts:149`) already reads this registry at daemon boot.

## The two defs

```ts
'reeval-sweep': {
  name: 'reeval-sweep',
  type: TriggerType.Cron,
  target: {
    kind: JobKind.Eval,
    payload: { mode: EvalMode.Sweep, reason: 'sweep' },
  },
  config: { schedule: reevalSweepCron() } satisfies CronConfig,
},
'reeval-on-pull': {
  name: 'reeval-on-pull',
  type: TriggerType.JobChain,
  target: {
    kind: JobKind.Eval,
    payload: { mode: EvalMode.AffectedByPull, reason: 'pull' },
  },
  config: {
    onKind: JobKind.Pull,
    onStatus: JobStatus.Done,
  } satisfies JobChainConfig,
},
```

### Mapping to EvalMode

- **`reeval-sweep`** (Cron): fires on the schedule read from
  `reevalSweepCron()` (the `AGENT_REEVAL_SWEEP_CRON` knob, default
  `0 4 * * *`, defined in `src/self-improve/config.ts`). Enqueues a
  `JobKind.Eval` job with `payload.mode = EvalMode.Sweep` — a full re-eval
  pass across every reusable artifact (D1: periodic drift sweep).
- **`reeval-on-pull`** (JobChain): fires whenever a `JobKind.Pull` job reaches
  `JobStatus.Done` (`config = { onKind: JobKind.Pull, onStatus: JobStatus.Done }`).
  Enqueues a `JobKind.Eval` job with `payload.mode = EvalMode.AffectedByPull`
  — a scoped re-eval of only the artifacts affected by the just-pulled model
  (D1: pull-event detection).

Both target `JobKind.Eval`, the job kind the dispatch registry (Task 16,
`src/server/jobs/dispatch.ts`) already routes to `RunEvalTurn` /
`createRealRunEvalTurn`.

## Master-switch handling

The brief does **not** call for gating registration on `reevalEnabled()`, and
its RED test exercises no enabled/disabled branch — so per the controller's
own instruction ("follow the brief"), I did **not** gate registration. I
confirmed this is the correct call by reading `src/self-improve/config.ts`
and its doc comment on `reevalEnabled()`:

> "Master switch for the self-improvement loop (sweep + pull hook +
> auto-demote). `0` disables all detection + demotion; ... A MANUAL
> single-artifact eval ... bypasses this switch by design."

The switch is enforced at **execution** time in
`src/self-improve/executor.ts` (its `mode !== Artifact` check), not at
**registration** time. Leaving both trigger defs always-registered means the
Ops console always shows them (never silently absent when the loop is
disabled) — consistent with how `sync.ts` handles an invalid repo Cron def
(registered but forced `enabled: false`, never omitted) and how a repo
`TriggerType.Webhook` def is registered visibly-disabled rather than dropped.
I added a doc comment on `TRIGGERS` in `triggers/index.ts` explaining this
choice explicitly so a future reader doesn't "fix" it by adding a gate.

No engine/gating code was written; this task was pure registry-content.

## TDD RED → GREEN

**RED** — wrote `tests/triggers/repo-reeval-triggers.test.ts` (the brief's
Step-1 test plus 3 extra assertions: schedule-from-knob, EvalMode payload on
both defs, JobChainConfig shape) against the still-empty `TRIGGERS`:

```
$ bun run test:file -- "tests/triggers/repo-reeval-triggers.test.ts"
 0 pass
 4 fail
error: script "test:file" exited with code 1
```

(all 4 failures were `undefined` lookups against the empty registry — the
expected RED.)

**GREEN** — added the two entries + imports to `triggers/index.ts`:

```
$ bun run test:file -- "tests/triggers/repo-reeval-triggers.test.ts"
 4 pass
 0 fail
 10 expect() calls
```

Ran `bunx biome check --write` to fix import ordering/formatting (biome
flagged import order + one multi-line `expect(...)` wrap), then re-verified:

```
$ bun run lint:file -- triggers/index.ts tests/triggers/repo-reeval-triggers.test.ts
Checked 2 files in 3ms. No fixes applied.

$ bun run typecheck
$ tsc --noEmit    (clean, no output)

$ bun run test:file -- "tests/triggers/repo-reeval-triggers.test.ts"
 4 pass, 0 fail, 10 expect() calls
```

Also ran the existing trigger-substrate suites that consume `TRIGGERS`
indirectly, to confirm the now-non-empty registry doesn't regress them:

```
$ bun run test:file -- "tests/triggers/sync.test.ts" "tests/triggers/engine.test.ts" "tests/triggers/types.test.ts"
 11 pass, 0 fail, 32 expect() calls
```

## Files changed

- `/Users/inderjotsingh/ai/triggers/index.ts` — added imports
  (`reevalSweepCron`, `EvalMode`, `JobKind`/`JobStatus`, `CronConfig`/
  `JobChainConfig`/`TriggerType`) and the two `TRIGGERS` entries + doc comment.
- `/Users/inderjotsingh/ai/tests/triggers/repo-reeval-triggers.test.ts` (new)
  — 4 tests covering type/target/config for both defs.

Commit: `c0adbca` — `feat(triggers): repo Cron sweep + model.pull JobChain trigger defs → Eval (no new TriggerType)`.

## Self-review

- Field names verified against the LIVE registry via `codegraph_explore`
  before writing anything (`triggers/index.ts`'s `TriggerDef`/`TRIGGERS`,
  `src/triggers/types.ts`'s `TriggerType`/`CronConfig`/`JobChainConfig`/
  `TriggerTarget`, `src/queue/types.ts`'s `JobKind`/`JobStatus`,
  `src/server/jobs/dispatch.ts`'s `EvalMode`, `src/self-improve/config.ts`'s
  `reevalSweepCron`) — no conflict with the brief, so I did not need to pause
  and ask.
- `reevalSweepCron()` is called at module-load (not lazily) — this matches
  the brief's explicit note ("acceptable because `TRIGGERS` is read at boot
  by `syncRepoTriggers`") and mirrors how the existing empty-registry
  scaffold was already structured (a plain object literal, not a function).
- No hardcoded cron string anywhere — schedule always comes from
  `reevalSweepCron()`.
- String-enum values only; no `console.log`; `type`-only imports used where
  only types are needed (`CronConfig`, `JobChainConfig`, `TriggerInput`).
- Did not touch `src/triggers/engine.ts`, `sync.ts`, or any dispatch wiring —
  out of scope per the brief ("no engine change needed").
- Left the `// TRIGGER-BUILDER:IMPORTS` / `// TRIGGER-BUILDER:ENTRIES`
  scaffold markers untouched and in place (generated-content insertion
  points for the trigger builder), placing my hand-written entries above
  them as the brief's sample did.

## Concerns

- None blocking. One minor observation for the slice's final review: because
  both defs are unconditionally registered regardless of `reevalEnabled()`,
  when the master switch is off the Ops console will still show
  `reeval-sweep` / `reeval-on-pull` as "enabled" triggers that fire but whose
  resulting Eval jobs presumably become no-ops (or are guarded) inside the
  executor — worth the final review double-checking that
  `src/self-improve/executor.ts`'s `mode !== Artifact` short-circuit is
  actually reached for jobs dispatched via these triggers (i.e., the
  Eval-job dispatch path in `dispatch.ts` doesn't itself skip the switch
  check) so a disabled loop doesn't burn compute on sweep/pull jobs that
  silently do nothing useful downstream. This is an integration concern
  across Tasks 14/16/17, not a defect in this task's own scope.
