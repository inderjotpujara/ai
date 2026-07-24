# Task 2 Report — Capture `verifiedWith` at commit (agent + crew builders)

Slice 32 (self-improvement loop). Branch `slice-32-self-improvement`.
Commit `66a0013` — "feat(verified-build): capture verifiedWith from the
resolved model pick at gate commit".

(Note: this report file previously held stale content from Slice 31's
unrelated Task 2 — config knobs/ATTR keys/a2a spans. It has been
overwritten with this task's actual report.)

## Summary

Threaded the resolved model identity (`VerifiedWith`, from Task 1's
`verifiedWithFrom`) through the live-resolve seam in
`makeRealBuilderDeps` (`src/agent-builder/deps.ts`) into both the
agent-builder and crew-builder commit closures, so `upsertEntry` now
persists `ManifestEntry.verifiedWith` on every commit — capturing exactly
which model proved the artifact.

## Codegraph-verified seams (before editing)

Used `mcp__codegraph__codegraph_explore` (not grep/Read) to confirm the
live seams before touching anything:

- `src/agent-builder/deps.ts:264` — `const { decl, numCtx } = await resolveModel(...)` inside `makeRealBuilderDeps`, exactly as the brief described. No drift from the brief's line numbers.
- `src/agent-builder/builder.ts:267` — the `commit` closure inside `verifyAndCommitProposal`, calling `upsertEntry(verify.dir, p.name, {...})`. No drift.
- `src/crew-builder/deps.ts` — `makeRealCrewBuilderDeps` does **not** call `resolveModel` itself; it reuses `makeRealBuilderDeps`'s already-resolved `agentDeps.verify` bundle (embed/judgeCandidates/judge/generatorFamily/confirmReuse/force) and adds only `runArtifact`. So the crew-builder path needs no second resolve — it just forwards `agentDeps.verify.verifiedWith`. Confirmed via codegraph + a direct Read of the file (the doc comment above `makeRealCrewBuilderDeps` explicitly says it reuses the agent-builder's bundle "correctly, for its own member-agent auto-build path").
- `src/crew-builder/builder.ts:304` (`commit` closure inside `verifyAndCommitCrewOrWorkflow`) — calls `upsertEntry(dir, staged.id, {...})` where `dir = dirFor(shape, deps.paths)` (crews vs workflows), NOT `verify.dir` (crew-builder's verify bundle has no `dir` field, per its own type comment). `verifiedWith` still comes from `verify.verifiedWith` regardless of which directory the entry lands in.
- `src/verified-build/types.ts` — confirmed `ManifestEntry.verifiedWith?: VerifiedWith` and the `VerifiedWith` shape (`runtime`, `model`, `paramsBillions`, `numCtx`, `quant?`, `capturedAtMs`) already landed from Task 1, unchanged.
- `src/verified-build/verified-with.ts` — confirmed `verifiedWithFrom({ decl, numCtx })` is the correct, already-exported helper; used it as-is, did not re-derive the mapping.

No line-number drift vs the brief; the only detail the brief left implicit (crew-builder has no separate `resolveModel` call — it forwards the agent-builder's) matched the live code exactly, so no deviation was needed and no clarification was blocking.

## TDD evidence

### RED

Added one test per gate-integration file, both asserting the persisted
manifest entry carries `verifiedWith.model`:

- `tests/agent-builder/gate-integration.test.ts` — `'commit persists verifiedWith from the resolved model pick'`
- `tests/crew-builder/gate-integration.test.ts` — `'commit persists verifiedWith from the resolved model pick'`

Command:
```
bun run test -- -t "commit persists verifiedWith"
```
Output (before implementation):
```
error: expect(received).toBe(expected)
Expected: "A:7b"
Received: undefined
  at tests/crew-builder/gate-integration.test.ts:429
(fail) commit persists verifiedWith from the resolved model pick

error: expect(received).toBe(expected)
Expected: "A:7b"
Received: undefined
  at tests/agent-builder/gate-integration.test.ts:456
(fail) buildAgent — verify-then-commit gate (deps.verify present) > commit persists verifiedWith from the resolved model pick

 0 pass
 31 skip
 2 fail
```
Both failed for the expected reason: `verifiedWith` did not exist on the
verify-deps bundle yet, so nothing reached the commit closure's
`upsertEntry` call and the manifest entry's `verifiedWith` was undefined.

### GREEN

After implementation (see below), same command:
```
bun run test -- -t "commit persists verifiedWith"
```
Output:
```
 2 pass
 31 skip
 0 fail
 4 expect() calls
Ran 33 tests across 505 files. [1.86s]
```

## Implementation

1. **`src/agent-builder/types.ts`** — added `verifiedWith?: VerifiedWith` to `BuilderVerifyDeps` (imported `VerifiedWith` from `../verified-build/types.ts`).
2. **`src/agent-builder/deps.ts`** — imported `verifiedWithFrom`; immediately after the `resolveModel` call (before `createModel`), added:
   ```ts
   const verifiedWith = verifiedWithFrom({ decl, numCtx });
   ```
   and exposed it on the `verify` object next to `dir`/`force`: `verifiedWith,`.
3. **`src/agent-builder/builder.ts`** — in the `commit` closure's `upsertEntry` call, added `verifiedWith: verify.verifiedWith`.
4. **`src/crew-builder/types.ts`** — added `verifiedWith?: VerifiedWith` to `CrewBuilderVerifyDeps` (imported `VerifiedWith`).
5. **`src/crew-builder/deps.ts`** — in `makeRealCrewBuilderDeps`, added `verifiedWith: agentDeps.verify.verifiedWith` to the constructed `CrewBuilderVerifyDeps` object (the SAME live resolve the agent-builder already captured — deliberately no second resolve).
6. **`src/crew-builder/builder.ts`** — in the `commit` closure's `upsertEntry` call, added `verifiedWith: verify.verifiedWith`.

No per-runtime branching anywhere — `verifiedWith` flows uniformly through the existing `resolveModel` return, exactly as the repo's provider-agnostic rule requires. When a verify bundle carries no `verifiedWith` (e.g. a hermetic test wiring that never sets it), the field is simply `undefined` on the committed entry — never a crash (verified by every pre-existing gate-integration test, none of which set `verifiedWith` and all of which still pass).

## Files changed

- `src/agent-builder/types.ts`
- `src/agent-builder/deps.ts`
- `src/agent-builder/builder.ts`
- `src/crew-builder/types.ts`
- `src/crew-builder/deps.ts`
- `src/crew-builder/builder.ts`
- `tests/agent-builder/gate-integration.test.ts`
- `tests/crew-builder/gate-integration.test.ts`

## Gate (all three)

```
$ bun run typecheck
$ tsc --noEmit   → clean, no output, exit 0
```

```
$ bun run lint:file -- src/agent-builder/types.ts src/agent-builder/deps.ts \
  src/agent-builder/builder.ts src/crew-builder/deps.ts \
  src/crew-builder/builder.ts src/crew-builder/types.ts \
  tests/agent-builder/gate-integration.test.ts \
  tests/crew-builder/gate-integration.test.ts
Checked 8 files in 9ms. No fixes applied.
```
(One `bunx biome check --write` pass was needed first, to fix import-order/formatting biome flagged in the two test files after adding the new `RuntimeKind`/`VerifiedWith` imports — pure reordering/reformatting, no logic changes.)

Focused test:
```
$ bun run test -- -t "commit persists verifiedWith"
2 pass, 0 fail
```

Full regression sweep on the affected areas:
```
$ bun test tests/agent-builder tests/crew-builder tests/verified-build
246 pass, 2 skip, 0 fail (563 expect() calls, 41 files)
```
Every pre-existing gate-integration/manifest/archive test still passes,
confirming the new optional field doesn't disturb any existing commit
path.

The commit itself also ran the repo's pre-commit `docs:check` hook
(`bun run scripts/docs-check.ts`), which passed cleanly — no
`src/<subsystem>` shape changed (no new file/module was added), so no
`architecture.md` edit was required for this task; the slice-level
living-doc/README/ROADMAP updates remain the controller's end-of-slice
responsibility per the repo's documentation hard line.

## Self-review

- **Provider/runtime-agnostic**: capture goes through the existing `resolveModel` return (`{ decl, numCtx }`) via `verifiedWithFrom` — no runtime-specific branching added anywhere.
- **No second resolve**: crew-builder deliberately does NOT call `resolveModel` again; it forwards the agent-builder's already-captured `verifiedWith`, consistent with how it already reuses `embed`/`judgeCandidates`/`judge`/`generatorFamily`/`confirmReuse`/`force` from the same bundle. One live resolve per build process, as intended.
- **Never crashes on absence**: `verifiedWith` is optional everywhere (`BuilderVerifyDeps.verifiedWith?`, `CrewBuilderVerifyDeps.verifiedWith?`, `ManifestEntry.verifiedWith?`); `verify.verifiedWith` being `undefined` simply writes `undefined` into the entry object, which `JSON.stringify` drops from the persisted `.generated.json` — same behavior as every other optional field on `ManifestEntry`.
- **Style**: `type` over `interface` (no new interfaces), no `console.log` added, early returns unaffected, small targeted diffs (89 insertions, 4 deletions across 8 files).
- **Test hygiene**: both new tests mirror the exact style/fixture conventions already used in their respective files (`fakeVerify`/`Partial<BuilderVerifyDeps>` merge pattern), no new helper scaffolding invented.

## Concerns

- None blocking. One clarifying note for the reviewer: `verifiedWith` is written into the manifest as whatever `verify.verifiedWith` was at deps-construction time, not re-derived per individual commit call. Since `makeRealBuilderDeps`/`makeRealCrewBuilderDeps` each do exactly one live resolve per build-process invocation (at the top, before the verify bundle is built), and every commit within that same process is for the SAME build, this is correct and is exactly what "capture the resolved model identity... at artifact-commit time" means in practice — the resolve happens once, upstream, and is carried unchanged into the commit. Flagging only so a later reviewer doesn't mistake "captured at deps-construction" for a discrepancy from "captured at commit."
- Pre-existing unstaged changes in `.remember/`, `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-1-brief.md`, `.superpowers/sdd/task-1-report.md`, `.superpowers/sdd/task-2-brief.md`, and an untracked `AGENTS.md`/`.remember/today-2026-07-23.md` were present in the working tree before this task started and were deliberately left OUT of this task's commit (not part of Task 2's scope) — flagging so the controller doesn't mistake them for something this task should have picked up.
