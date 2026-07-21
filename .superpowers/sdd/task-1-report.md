# Task 1 report — Engine trigger types + enums (Slice 25)

(Note: this file previously held a report for an unrelated Slice 25b
Increment-1 task that reused this filename. Overwritten with the Slice 25
Task 1 report below.)

## Status: DONE

## Commit
- `3eea5c3` — `feat(triggers): engine trigger types + enums (+ src/triggers docs stub)`

## What was done

Followed TDD exactly per `.superpowers/sdd/task-1-brief.md`'s steps:

1. **Wrote the failing test** — `tests/triggers/types.test.ts`, asserting the
   exact wire-string values of `TriggerType`, `TriggerOrigin`, and
   `TriggerOutcome`.
2. **Confirmed it fails** — `bun run test -- -t "TriggerType holds"` →
   `error: Cannot find module '../../src/triggers/types.ts'` (1 fail, 1 error).
3. **Implemented `src/triggers/types.ts`** — exactly the Produces block from
   the brief:
   - `enum TriggerType { Cron='cron', Webhook='webhook', File='file', JobChain='jobchain' }`
   - `enum TriggerOrigin { Repo='repo', Console='console' }`
   - `enum TriggerOutcome { Fired='fired', SkippedOverlap='skipped-overlap', Failed='failed' }`
   - `enum FileEventKind { Add='add', Change='change' }`
   - `CronConfig`, `WebhookConfig`, `FileConfig`, `JobChainConfig`,
     `TriggerConfig` (union), `TriggerTarget`, `Trigger`, `TriggerFiring`,
     `TriggerInput`
   - Imports `type { JobKind, JobStatus }` from `../queue/types.ts` only — no
     `RunOrigin` import, since nothing in this file's Produces block actually
     references it (per the brief's "RunOrigin is only re-referenced in later
     modules; import lazily where used" note).
4. **Confirmed it passes** — `bun run test -- -t "TriggerType holds"` → 1
   pass, 0 fail.
5. **Landed the `docs/architecture.md` stub** — inserted the brief's verbatim
   stub section (`### \`src/triggers/\` — trigger engine (Slice 25, stub)`)
   at the end of §24, right after §24.8's config-knobs table and before the
   `---` separator + the "Jobs & Triggers Ops Console (web UI — Slice 25b)"
   section — i.e. directly adjacent to the Queue (§24.1)/Daemon (§24.3)
   subsystem narrative, as instructed.
6. **Gate + commit**:
   - `bun run typecheck` → clean (after the test-file cast noted below).
   - `bun run lint:file -- src/triggers/types.ts tests/triggers/types.test.ts`
     → clean (biome auto-fixed formatting/multi-line array wrapping on both
     files; re-ran lint after and it was clean).
   - `bun run docs:check` → `✔ docs-check: living docs present + linked;
     every src subsystem documented.`
   - Focused test: `bun run test:file -- "tests/triggers/types.test.ts"` → 2
     pass, 0 fail, 3 expect() calls.
   - Committed exactly the three intended files:
     `src/triggers/types.ts`, `tests/triggers/types.test.ts`,
     `docs/architecture.md`.

## Deviation from the brief's literal test snippet (and why)

The brief's Step-1 test snippet does `Object.values(TriggerType).sort()`
without a cast. Under this repo's `tsc --noEmit` (part of the mandatory
per-task gate — `bun test` alone doesn't type-check), TS enum member values
don't structurally widen to `string[]` for `.toEqual([...])` against
string-literal arrays, so that snippet fails typecheck even though it passes
at runtime. The sibling file `tests/queue/types.test.ts` establishes the
repo's existing convention for exactly this situation: cast to `as string[]`
before `.sort()`/`.toEqual()`. I applied the same cast to all three
assertions so the test both passes at runtime and type-checks cleanly — same
coverage the brief specified, just typed to match repo convention. Biome then
reflowed the multi-value `.toEqual([...])` arrays onto multiple lines
(auto-fix), reflected in the committed file.

## Test output (focused)

```
$ bun test --path-ignore-patterns 'web/**' --path-ignore-patterns 'spikes/**' tests/triggers/types.test.ts
bun test v1.3.11 (af24e281)

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [12.00ms]
```

## Self-review

- Enum wire values, type shapes, and field names match the brief's Produces
  block verbatim (checked field-by-field).
- `JobKind`/`JobStatus` imported as `type`-only from `../queue/types.ts`,
  mirroring `src/queue/types.ts`'s own style (string enums, `type` over
  `interface`, small file, no stray runtime imports).
- `RunOrigin` (`src/contracts/enums.ts`) is listed as "consumed" in the brief
  but has no corresponding field in this file's Produces block (`origin` on
  `Trigger`/`TriggerInput` is `TriggerOrigin`, this module's own enum, not
  `RunOrigin`). Left unimported here per the brief's explicit lazy-import
  instruction — flagging it so a later task's reviewer isn't surprised that
  the "Consumes" line's `RunOrigin` has no import in this particular file.
- Docs stub placed adjacent to the Queue/Daemon narrative sections as
  directed, not merely appended at file end — keeps the doc readable in
  section order pending the full Task-34 expansion.
- Ran a full `bun run test` in the background as an extra sanity check beyond
  the brief's required gate; did not block the commit on it since it isn't
  part of the specified per-task gate and this project's convention (per
  project memory) is focused-test-inline, full-suite-between-tasks.

## Concerns
None outstanding.
