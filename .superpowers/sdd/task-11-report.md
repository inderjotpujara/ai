# Task 11 report: CrewMember.agentRef + crew-engine resolution (Slice 19)

**Status:** DONE.

*(Note: this path previously held a stale Slice-18 report — "MLX control
surface via injectable factory" — for a differently-numbered Task 11.
Overwritten here per the same file-reuse convention that report itself
documented.)*

## What was implemented

1. `src/crew/types.ts` — added optional `agentRef?: string` to `CrewMember`
   (additive, doc comment: "When set, reuse this registered AGENTS specialist
   instead of an inline build.").
2. `src/crew/engine.ts` — imported `AGENTS` from `../../agents/index.ts`; in
   `crewAgentMap`, when `member.agentRef` is set and matches a registered
   factory, use `AGENTS[member.agentRef](memberTools)`; otherwise fall back
   to `buildCrewAgent(member, memberTools)` exactly as before.

```ts
const factory = member.agentRef ? AGENTS[member.agentRef] : undefined;
map[member.name] = factory
  ? factory(memberTools)
  : buildCrewAgent(member, memberTools);
```

## Import-cycle check

**No cycle.** Verified by inspecting every import line in `agents/*.ts`
(`file-qa.ts`, `web-fetch.ts`, `index.ts`, `super.ts`) — all of them import
from `../models/*`, `../src/core/*`, `../src/providers/*`, or sibling
`agents/*` files; none imports from `src/crew/*`. `src/crew/engine.ts`
importing `agents/index.ts` is therefore a leaf-consumer edge
(`crew -> agents -> core/providers`), not a cycle. Confirmed empirically too:
`bun run typecheck` is clean and `bun test tests/crew/` runs and passes (a
real dependency cycle between these two modules would surface as a runtime
`undefined` export or a TS circular-reference issue).

## TDD

**RED** — wrote `tests/crew/agent-ref.test.ts` (brief's test, with one
required deviation: `map.wf.name` → `map.wf?.name`, since this repo's
`tsconfig` strictness flags `map.wf` as possibly-undefined on a
`Record<string, Agent>` index; the assertion's behavior is unchanged).

```
$ bun test tests/crew/agent-ref.test.ts
error: expect(received).toBe(expected)
Expected: "web_fetch"
Received: "wf"
(fail) a member with agentRef resolves to the registered factory
0 pass / 1 fail
```

**GREEN** — implemented the two changes above.

```
$ bun run typecheck
$ tsc --noEmit   (clean, no output)

$ bun test tests/crew/
bun test v1.3.11
 21 pass
 0 fail
 51 expect() calls
Ran 21 tests across 7 files. [122.00ms]
```

Full `tests/crew/` suite green — no regressions across the 7 existing crew
test files.

```
$ bun run lint:file -- src/crew/types.ts src/crew/engine.ts tests/crew/agent-ref.test.ts
Checked 3 files in 2ms. No fixes applied.
```
(one round of `bunx biome check --write` was needed first, to fix import-sort
+ multiline formatting in the new test file only; the two `src/` files
needed no fixes.)

## Files touched
- `src/crew/types.ts` (+2 lines: `agentRef?` field + doc comment)
- `src/crew/engine.ts` (+5/-1 lines: import + factory resolution)
- `tests/crew/agent-ref.test.ts` (new, 24 lines)

## Commit
`f20919e` — `feat(crew): CrewMember.agentRef reuses a registered specialist`

## Self-review
- Additive-only: `agentRef` is optional, existing `CrewDef`/`CrewMember`
  callers unaffected; the fallback path (`factory ? ... : buildCrewAgent(...)`)
  preserves today's behavior byte-for-byte when `agentRef` is absent or
  doesn't match a registered name.
- No `console.log`; no new string-literal unions introduced (nothing to
  convert to `enum`).
- Style matches the brief exactly except the `?.` noted above (typecheck-
  forced, not a behavior change).

## Concerns
- **Process note, not a code defect in this task's diff:** the commit
  `f20919e` also carries an unrelated update to
  `.superpowers/sdd/task-10-report.md` (content changed from an older
  Slice-18-era hf-fetch report to the current Slice-19 Task-10
  "transpiler↔engine round-trip" report, matching commit `6cf2ddc` two
  commits below mine). That change was apparently staged in the index by a
  concurrently-running Task-10 agent sharing this working tree (no worktree
  isolation), and got swept into my commit because I ran a bare
  `git add <3 files> && git commit` — `git commit` without a pathspec
  commits the **entire** index, not just the files just `add`ed. The
  swept-in content is itself correct/legitimate (documents real, already-
  committed work), so there's no data loss or corruption — just commingled
  attribution across two tasks' commits. I did not attempt to split or
  rewrite history, since other task agents may be actively committing
  concurrently in this same branch and a rewrite risked colliding with
  their work. Flagging so the controller/ledger-writer is aware `f20919e`'s
  diff is slightly wider than Task 11's own file list. Suggest future
  concurrent dispatches use pathspec-scoped `git commit -- <paths>` when
  multiple task agents share a working tree without worktree isolation.
