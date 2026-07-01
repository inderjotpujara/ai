## Task 11: In-repo eval gate (golden set)

**Files:** Create `tests/verification/golden/cases.json`, `tests/verification/faithfulness.eval.test.ts`

- [ ] **Step 1:** Author `cases.json` — ~15–20 `{ id, answer, evidence:[{id,text}], expectedSupported }`, incl. planted hallucinations, uncited-claim, and no-evidence cases.
- [ ] **Step 2:** Write `faithfulness.eval.test.ts` that runs the project's `verify()` with a deps built from a fixed fake `generate` implementing a simple lexical-entailment stand-in (deterministic, offline) OR the general-model fallback path, over each case; assert detection precision/recall ≥ target (e.g. all planted hallucinations flagged; ≤1 false-abstention). Gate it in `bun run check` (it's a normal `bun test`).
> The offline eval uses a deterministic stand-in judge so `bun run check` is hermetic. A `.live` variant (Task 12) runs the SAME golden set through real MiniCheck.
- [ ] **Step 3:** Run + commit `test(verification): in-repo faithfulness golden-set eval gate`.

---

