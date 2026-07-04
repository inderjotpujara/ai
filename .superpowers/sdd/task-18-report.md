### Task 18: chat multi-step gap trigger — report

> Note: this report path previously held an unrelated Task-18 report from an
> earlier slice's numbering ("MCP `MCP_TRANSPORT` attr emission"). Replaced
> here with the correct Slice-19 Task-18 report per the brief's instructions.

**Status:** Done.

**Commit:** `190afc9` — `feat(cli): route multi-step chat gaps to the crew/workflow builder`

**Files:**
- Added `src/cli/offer-crew.ts` — exports `shouldOfferCrew(text: string): boolean`, a pure regex heuristic (`/\b(then|after that|steps?|workflow|team|crew|pipeline)\b/i`). No console output; pure function per the constraint.
- Added `tests/cli/offer-crew.test.ts` — 6 tests: multi-step phrasing → true, single capability → false, plus extra phrasings ("steps"/"workflow", "team"/"crew", "pipeline"/"after that", case-insensitivity).
- Modified `src/cli/chat.ts` — 3 new imports (`buildCrewOrWorkflow` from `../crew-builder/builder.ts`, `makeRealCrewBuilderDeps` from `../crew-builder/deps.ts`, `shouldOfferCrew` from `./offer-crew.ts`) and a new branch inserted inside the existing `else if (result.kind === 'gap')` block, before the pre-existing single-agent offer.

**How chat.ts's gap branch actually looked (vs. the brief):**
The brief's snippet matched the real code closely. The actual gap branch is:
```ts
} else if (result.kind === 'gap') {
  console.log(result.message);
  if (interactiveTTY()) {
    const wants = await askYesNo(`Propose a new agent for "${result.missingCapability}"?`, ...);
    if (wants) { ... buildAgent ... }
  }
}
```
No pre-existing `multiStep` field on the gap result — went with the heuristic fallback as the brief allowed ("gate on a heuristic in chat.ts ... fall back to the heuristic only if the core change balloons"). Did not touch `src/core`'s gap-result shape at all — purely additive in `chat.ts`.

**Integration:** Inserted the crew-offer branch first, gated on `interactiveTTY() && shouldOfferCrew(\`${result.missingCapability} ${task}\`)`. On yes: `makeRealCrewBuilderDeps()` → `buildCrewOrWorkflow(...)` inside try/finally (cleanup in finally) → on `built.kind === 'written'` print `Created ${built.shape} "${built.name}" — re-run to use it.` → unconditional `return` inside the `if (wantsCrew)` block (so declining the crew *offer* falls through to the existing single-agent offer, but accepting it — written or not — returns and skips the single-agent offer, matching the brief's "handled; skip the single-agent offer" comment). The pre-existing `if (interactiveTTY()) { ... Propose a new agent ... }` block is untouched and still runs verbatim when `shouldOfferCrew` is false or the user declines the crew offer.

**TDD:**
- RED: `bun test tests/cli/offer-crew.test.ts` failed with `Cannot find module '../../src/cli/offer-crew.ts'` before the source file existed.
- GREEN: after writing `src/cli/offer-crew.ts`, all 6 tests pass.

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/cli/ tests/crew-builder/` — 102 pass, 0 fail, 207 expect() calls across 26 files (no regressions; `tests/cli/chat.test.ts` doesn't exercise the gap branch at all — it only covers `maybeAutoProvision`/`warnUnknownChatAgents` — so risk of breaking it was low, and it stayed green).
- `bun run lint:file -- src/cli/offer-crew.ts src/cli/chat.ts tests/cli/offer-crew.test.ts` — clean (biome, no fixes needed).
- `git commit` ran the pre-commit `docs-check` hook, which passed (this task didn't touch `docs/architecture.md` since it's a purely additive CLI wiring change to an already-documented subsystem, not a new one).

**Self-review:**
- Import ordering: initially misplaced the `./offer-crew.ts` import mid-way through the `../resource/*` group; caught it before running lint and moved it to sort correctly among the same-directory (`./`) imports at the end of the import block. Lint confirmed clean after the fix.
- Confirmed only my three files were staged before committing (`git status --short` showed a long list of unrelated `M` files from other in-flight SDD tasks in this slice — none were `git add`ed).
- `return` inside the `if (wantsCrew)` block returns from the async callback passed to `withMcpRun`, not from `main()` directly — same pattern the brief's snippet used; verified this is a normal function-scope return, not a loop/switch fall-through issue.

**Concerns:**
- None blocking. One judgment call worth flagging: per the brief, `return` fires whenever the user says yes to the crew offer, even if `buildCrewOrWorkflow` returns `declined`/`invalid`/`abandoned` (not just `written`) — the single-agent offer is skipped either way once the user has engaged with the crew flow. This matches the brief's explicit snippet and comment, but means a user who says "yes, propose a crew" and then rejects the *proposed* crew IR won't be re-offered the single-agent path in the same run (they'd need to re-run `chat`). Flagging for awareness, not changing without direction since it matches the brief exactly.

**Report path:** `/Users/inderjotsingh/ai/.superpowers/sdd/task-18-report.md`
