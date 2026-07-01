# Task 11 report: in-repo faithfulness eval gate (Slice 13)

## Files
- `tests/verification/golden/cases.json` (new) — 20 golden cases.
- `tests/verification/faithfulness.eval.test.ts` (new) — eval gate exercising the real `verify()` pipeline.

## Case spread (20 total, in `cases.json`)
- **grounded-01..07** (7 cases): answers with `[mem:id]` citations whose claims are faithfully supported by the cited evidence text. Includes single-claim and two-claim (two-sentence, two-citation) answers to exercise multi-claim aggregation.
- **hallucination-01..07** (7 cases): each pairs a real evidence chunk with an answer whose claim contradicts or fabricates details against that same chunk (wrong mechanism, wrong number/date, wrong causal story) while still citing the correct `[mem:id]` — this specifically tests the per-claim judge, not citation parsing.
- **uncited-01..03** (3 cases): answer text is true and even matches an evidence chunk's content, but carries **no** `[mem:id]` tag at all — tests the "no citation → unsupported" path in `judge.ts#verifyFaithfulness` (citedIds.length === 0 short-circuit) independent of correctness.
- **no-evidence-01..03** (3 cases): answer cites an id (`mem:missing#N`) that has no corresponding entry in that case's `evidence` array — tests the "cited chunk missing" path (`getByIds` returns nothing for that id, so `evidenceById` lookup is empty and `checkClaim` sees blank evidence → unsupported).

All `answer` strings carry literal `[mem:<id>]` tags matching evidence ids where a citation is meant to exist, so the real `decomposeClaims` → `parseCitations` machinery in `src/verification/claims.ts` is genuinely exercised end to end (not bypassed).

## The stand-in `generate` (deterministic, offline)
`buildDeps(case)` returns a `VerifyDeps` whose `generate` inspects the prompt shape sent by `verify.ts`:

1. **Decompose prompt** (`prompt.includes('atomic factual claims')`, from `claims.ts#decomposeClaims`): a `splitIntoClaims()` helper splits the answer on sentence boundaries (`/(?<=[.!?])\s+/`), and for each sentence extracts only the `[mem:id]` tags that appear *within that sentence's span* (regex `[mem:([^\]]+)]` scoped per-sentence), then strips the tags from the claim text. Returns a JSON array `{text, citedIds}[]` — exactly the shape `decomposeClaims` expects to `JSON.parse`. This is a faithful, deterministic stand-in for what an LLM decomposer should produce on these short golden answers, and it exercises the real JSON-parsing / citation-attachment logic (not a shortcut that hands the pipeline pre-built claims).
2. **Judge prompt** (`Document:\n...\n\nClaim: ...` shape from `judge.ts#checkClaim`): a `lexicalJudge(claim, document)` heuristic:
   - Tokenizes both claim and document into lowercase content words, strips `[mem:id]` tags and punctuation, drops stopwords, and applies a crude suffix-stripping stemmer (`stem()`) so "converts"/"convert", "uses"/"using", "stored"/"storing" fold together.
   - Computes overlap ratio = (claim words present in document) / (total claim words); requires ratio ≥ 0.75.
   - **Numeric guard**: extracts all `\d+` tokens from the claim and requires every one to also appear in the document. Added specifically because `hallucination-04` (French Revolution "1650" vs. evidence "1789") was lexically close enough (shared words: "french", "revolution", "began") to clear the 0.75 word-overlap bar on its own — the numeric-exact-match requirement is what correctly flags date/quantity swaps as unsupported.
   - Returns `"Yes"` only if both conditions hold, else `"No"` — matching the `Yes`/`No` string contract `checkClaim` parses via `.toLowerCase().startsWith('yes')`.

`ensureJudge` always returns `{model: 'stand-in', fallback: true}`.

## Metrics asserted
In `golden set: verify() detection quality vs expectedSupported`:
- Case count sanity: 15 ≤ cases.length ≤ 20 (20 actual).
- Both expected-fail and expected-pass buckets non-empty (spread sanity).
- **Recall of failures = 100%**: `missedHallucinations` (expected-fail cases where `verify()` said supported) must be `[]`; `failRecall` computed and asserted `=== 1`. Failure message lists any missed ids by name for debuggability.
- **False-abstention bound**: grounded cases wrongly flagged unsupported must be `[]` (currently 0 of 7), with a hard ceiling asserted at `<= 1` (the task's "≤ a small bound" requirement) — the bound is looser than the observed 0 to leave slack for stand-in judge variance rather than being a tautological pass.
- **Precision on the unsupported call** ≥ 0.95: of everything flagged unsupported, the fraction that was a true expected-fail case (currently 13/13 = 1.0).

A second test asserts fixture sanity (no duplicate evidence ids per case). A third asserts category coverage (≥3 grounded, ≥3 hallucination, ≥2 uncited, ≥2 no-evidence) so the spread requirement is enforced by the suite itself, not just eyeballed.

None of these assertions are tautological: they compare `verdict.supported` (computed by the real `verify()` → `decomposeClaims` → `verifyFaithfulness` → `checkClaim` pipeline) against each case's independently-authored `expectedSupported` label.

## TDD evidence
1. First full run surfaced exactly one failure: `hallucination-04` (year swap) was scored "supported" because plain word-overlap (5/7 shared tokens: french/revolution/began) cleared 0.75 despite the number differing — added the numeric-exact-match guard, which fixed it without touching any golden case.
2. That fix then surfaced three false abstentions on grounded cases (`grounded-02`, `-03`, `-07`) because unstemmed word forms ("uses" vs "using", "converts" vs "convert", "stored" vs "storing") pulled ratios to 0.71/0.71/0.6, under threshold — added a minimal suffix-stripping stemmer, which fixed all three without loosening the 0.75 threshold or touching the numeric guard.
3. Final run: 3/3 tests pass, 33 `expect()` calls, deterministic (re-ran twice, identical result).

## Verification run
- `bun test tests/verification/faithfulness.eval.test.ts` — 3 pass, 0 fail, 33 expect() calls.
- `bun run typecheck` — clean.
- `bun run lint:file -- tests/verification/faithfulness.eval.test.ts tests/verification/golden/cases.json` — clean (after one biome auto-format pass).
- `bun run check` (full gate: docs:check + typecheck + lint + test) — **293 pass, 18 skip, 0 fail, 631 expect() calls, 311 tests across 102 files**. No `src/**` files touched, so no `docs/architecture.md` update was required for this test-only change.

## Files touched
- `tests/verification/golden/cases.json` (new)
- `tests/verification/faithfulness.eval.test.ts` (new)

## Concerns
- The lexical stand-in is intentionally coarse (word-overlap + stemming + numeric guard) and is **not** meant to generalize beyond this golden set — it's tuned jointly with the 20 cases as called for in the brief. Task 12's `.live` variant against real MiniCheck is the check that the *real* judge model, not just this stand-in, achieves similar detection quality.
- Only 1 case (`hallucination-04`) required the numeric guard; if future golden cases add other subtle contradiction shapes (e.g., negation flips like "always" → "never"), the heuristic will likely need a corresponding targeted extension, same as here — this is expected maintenance, not a design flaw.
- Committed only the two new test files; other repo-wide modified files (`.remember/`, `.superpowers/sdd/task-*-brief.md`/`task-*-report.md` for other tasks, etc.) were left untouched as they belong to other in-flight tasks/agents. Note: this path (`task-11-report.md`) previously held a stale, unrelated report from an earlier/different task-numbering context (a `bun run memory` CLI report) — it has been overwritten with this task's content per the brief's explicit instruction to write to this exact path.

## Commit
`test(verification): in-repo faithfulness golden-set eval gate` on branch `slice-13-grounded-verification`.
