# Slice 13 — Grounded verification — design

**Date:** 2026-07-01
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 8 (telemetry/spans), Slice 9 (guardrails), Slice 10 (workflow engine — branch/map steps + context threading), Slice 11 (crews — tasks/dependsOn/compile), Slice 12 (memory/RAG — citation-tagged `[mem:<id>]` recall + abstention primitive + the store).
**Feeds:** Slice 14 (first-boot model provisioning + downloader — generalizes the "ensure a model is present, with consent + progress" seam this slice introduces minimally for MiniCheck).

---

## 1. Problem & goal

Slice 12 gave crews/workflows semantic memory, but memory alone still lets an agent **retrieve-then-hallucinate**: it can cite `[mem:<id>]` tags that don't actually support its claims, or answer confidently with no evidence. This slice adds the **verification layer** — the "grounded & trustworthy by default" half of Phase B — so an answer is checked against its evidence before it's presented, and an ungrounded answer is **abstained** rather than shown.

The framework's own thesis makes this natural: **a verifier is just another agent / crew task / workflow step.** No new engine — verification composes on the Slice-10/11 substrate.

### Validated framing (mid-2026, re-checked at slice-time — see [[reference-rag-grounding-findings]])
- **Faithfulness judge = a small FINE-TUNED checker, not a general-LLM prompt.** Default **`bespoke-minicheck`** (Bespoke-MiniCheck-7B) on Ollama — SOTA on LLM-AggreFact, ~100-200ms, interface `(document, claim) → Yes/No` = exactly the per-claim entailment step, and model-swap-proof. Claim **decomposition** still uses a general LLM (the router); only the per-claim **verify** is MiniCheck.
- **Citation-verification fused into the same pass** — a citation is a *claim*, not proof. Verify each claim against the chunk it cites → one mechanism, two guarantees (faithfulness + citation-correctness).
- **CRAG > Self-RAG** (model-agnostic): CRAG's retrieval grader is a separate classifier → survives model swaps; Self-RAG bakes reflection tokens into one fine-tuned model → rejected. The workflow engine has branch/map but **no native loop**, so CRAG re-retrieve is a **bounded (1×) unrolled** path, not a loop.
- **Abstention** on no/low evidence — extends the existing `report_capability_gap` stance from "no capability" to "no evidence."
- **Deferred:** CoVe (4× cost), semantic-entropy/SEPs (needs logit access Ollama doesn't expose), self-consistency, external eval frameworks (RAGAS/Promptfoo/DeepEval), NeMo/Guardrails-AI, generation-time citation (we do post-hoc), Self-RAG.

### Locked decisions (from brainstorm)
1. **Full v1**: faithfulness judge (MiniCheck) + citation-verification (fused) + bounded CRAG + abstention + an in-repo eval gate.
2. **Opt-in, auto-inserted**: a `verify: true` flag on a crew/task (and `--verify` on the flow/crew CLI) auto-appends the verify → branch → (corrective → re-verify) → abstain path. The reusable `verify()` primitive + a `verifier` agent also stay available for manual composition.
3. **Abstain on final failure**: a new `{kind:'unverified'}` outcome carrying the unsupported claims + faithfulness score. The ungrounded draft is saved to `runs/<id>/unverified.txt` + the trace, **not** presented as the answer.
4. **Evidence = the chunks the answer cites**: parse `[mem:<id>]` from the answer → fetch those chunks via a new `MemoryStore.getByIds` → verify each claim against its cited chunk. Uncited claim → no evidence → unsupported (this *is* citation enforcement). No citations at all → abstain.
5. **MiniCheck via consent-then-pull**: if the judge model isn't installed, verification **asks the user (y/n, shows the size) to pull it** in an interactive TTY; on decline (or non-interactive/test context) it **falls back to a general-model NLI prompt** with a logged notice — degrade, never hard-fail. (This minimal "ensure-model-present-with-consent" seam is generalized by Slice 14's downloader.)
6. **No new npm dep** (MiniCheck is an Ollama pull). **Telemetry-to-emit**: `verification.check` span + `ATTR.VERIFICATION_*`. **Architecture-doc update**: new "Verification" section + `src/verification/` node/edges.

---

## 2. Components (new dir `src/verification/`)

### 2.1 `src/verification/types.ts`
```ts
export enum CragGrade { Correct = 'correct', Ambiguous = 'ambiguous', Incorrect = 'incorrect' }

/** One atomic claim extracted from an answer + the chunk id(s) it cites. */
export type Claim = { text: string; citedIds: string[] };

export type ClaimVerdict = { claim: string; citedIds: string[]; supported: boolean; reason?: string };

export type Verdict = {
  supported: boolean;          // faithfulness >= threshold
  faithfulness: number;        // fraction of claims supported (0..1)
  claims: ClaimVerdict[];
  unsupportedClaims: string[]; // convenience: the failed claim texts
  usedFallback: boolean;       // true if the general-model fallback judged (MiniCheck absent/declined)
};

export type VerifyOptions = { space?: string; threshold?: number; at: number };
```

### 2.2 `src/verification/claims.ts`
`decomposeClaims(answer: string, deps): Promise<Claim[]>` — a general-LLM (the router model) prompt that splits the answer into atomic factual claims and, for each, extracts the `[mem:<id>]` citation ids present in/near it (regex `\[mem:([^\]]+)\]` for the id capture; the LLM associates claims↔citations). A claim with no citation gets `citedIds: []`.

### 2.3 `src/verification/judge.ts`
- `ensureJudgeModel(model, deps): Promise<{ model: string; fallback: boolean }>` — if `model` is installed → use it; else if interactive TTY → prompt "pull `<model>` (~<size>)? [y/N]" and pull on yes; else / on decline → return `{ fallback: true }`.
- `checkClaim(claim: string, evidence: string, judgeModel, deps): Promise<boolean>` — MiniCheck call: prompt the judge model with `(document=evidence, claim)` → parse Yes/No. Fallback path uses a general-model NLI prompt returning the same boolean.
- `verifyFaithfulness(answer, claims, evidenceById, deps): Promise<Verdict>` — for each claim, gather its cited chunks' text (from `evidenceById`), `checkClaim` against the concatenation; a claim with no citation or missing evidence → `supported: false`. Aggregate `faithfulness = supported/total`; `supported = faithfulness >= threshold`.

### 2.4 `src/verification/crag.ts`
- `gradeRetrieval(query, chunks, deps): Promise<CragGrade>` — a router-model grading prompt classifying whether the retrieved chunks are relevant/sufficient for the query (Correct/Ambiguous/Incorrect).
- `correctiveRetrieve(query, store, deps): Promise<RetrievalResult[]>` — one bounded corrective pass: rewrite the query (router-model rewrite) + re-`recall`. Returns the new chunks (for a re-answer attempt).

### 2.5 `src/verification/verify.ts` (the primitive)
`verify(answer, { query, space }, deps): Promise<Verdict>`:
1. `decomposeClaims(answer)` → claims + citedIds;
2. gather evidence: `store.getByIds(space, allCitedIds)` → `evidenceById: Map<id, text>`;
3. if no cited ids at all → `Verdict{ supported:false, faithfulness:0, … }` (abstain-worthy);
4. `verifyFaithfulness(answer, claims, evidenceById, deps)` → `Verdict`.
Wrapped in `withVerificationSpan`.

### 2.6 `src/memory/store.ts` + `lancedb-store.ts` (extend)
`getByIds(space: string, ids: string[]): Promise<RetrievalResult[]>` — LanceDB `WHERE id IN (…)` (escaped), returning the chunks' `{id,text,source,…}`. Used by the verifier to fetch cited evidence. (Small, additive; keeps the store the single source of chunk text.)

### 2.7 `src/verification/verifier-agent.ts` + auto-insertion
- A built-in **`verifier`** agent (role = fact-checker) is not strictly needed since `verify()` is a deterministic primitive, BUT we expose verification as a **workflow tool/step** so it composes: `makeVerifyStep(answerStepId, {space})` produces the verify step whose output is a `Verdict`.
- **Auto-insertion (crew)**: `Task.verify?: boolean` / `CrewDef.verify?: boolean`. In `compileToWorkflow`, a task with `verify` gets, appended after it: a `verify` step (dependsOn the task, input = the task's answer + query) → a `Branch` on `verdict.supported` → **whenTrue**: pass-through the answer; **whenFalse**: a `corrective` step (rewrite+re-recall+re-answer, bounded 1×) → `verify₂` → `Branch₂` → whenTrue pass-through, whenFalse → **abstain** step (emits the `unverified` outcome).
- **Auto-insertion (workflow)**: an `AgentStep.verify?: boolean` (or a `withVerification(step, {space})` helper) expands to the same sub-graph at `defineWorkflow` time.
- CLI: `--verify` on `bun run flow`/`bun run crew` sets the crew/workflow-level flag.

### 2.8 Outcome / abstention
- `CrewOutcome` gains `| { kind: 'unverified'; failedTaskId?: string; unsupportedClaims: string[]; faithfulness: number; draft: string }`.
- The abstain step returns a sentinel the engine maps to this outcome; `runCrewCli`/`runFlow` write `runs/<id>/unverified.txt` (the draft + failed claims + score) instead of `result.txt`, and exit non-zero. Parallels the existing `gap`/`resource` handling.
- `VerificationError` added to `src/core/errors.ts` (thrown only on *misuse* — e.g. verify called with no memory store — not on a legitimate "unsupported" verdict, which is data, not an error).

### 2.9 `src/telemetry/spans.ts` (extend — additive)
`ATTR` gains `VERIFICATION_SUPPORTED`, `VERIFICATION_FAITHFULNESS`, `VERIFICATION_UNSUPPORTED`, `VERIFICATION_CRAG_GRADE`, `VERIFICATION_RETRIES`, `VERIFICATION_FALLBACK`. New `withVerificationSpan('verification.check', fn)` + a `recordVerdict(verdict)` annotate helper. Nests under `workflow.step`/`crew.task`.

### 2.10 Config (env fallback-only)
`AGENT_VERIFY_MODEL`=`bespoke-minicheck` · `AGENT_VERIFY_THRESHOLD`=`0.9` (0<n≤1) · `AGENT_VERIFY_MAX_RETRIES`=`1` · `AGENT_VERIFY_ENABLED` (global off-switch, default on when `verify` requested) · `AGENT_VERIFY_AUTO_PULL` (default: prompt; `=0` never prompt→straight to fallback, `=1` pull without prompting — for non-interactive provisioning).

### 2.11 Eval gate (in-repo, no external framework)
- `tests/verification/golden/*.json` — ~15–20 cases `{ answer, evidence:[{id,text}], expectedSupported:boolean }`, including planted hallucinations + uncited-claim + no-evidence cases.
- `tests/verification/faithfulness.eval.test.ts` runs the **project's own `verify()`** over the golden set (with the general-model fallback so it runs without MiniCheck) and asserts detection precision/recall ≥ a target (e.g. catches ≥ N/N planted hallucinations, ≤ M false-abstentions). Gated in `bun run check`. When MiniCheck IS installed, a `.live` variant asserts the same with the real checker.

---

## 3. Data flow (crew with `verify: true`)
```
task 'answer' (member recalls memory, cites [mem:id]) → ctx.answer
  → verify step: decomposeClaims(ctx.answer) → getByIds(cited) → MiniCheck per claim → Verdict
    → Branch(verdict.supported):
        true  → pass-through ctx.answer  → done
        false → gradeRetrieval → correctiveRetrieve (rewrite+recall) → re-answer → verify₂
                  → Branch₂: true → answer₂ → done ; false → ABSTAIN → {kind:'unverified'}
  → withVerificationSpan nests under crew.task ; bun run runs shows verification.check + verdict attrs
```

## 4. Error handling & determinism
- An "unsupported" verdict is **data, not an error** — it drives the branch, never throws. `VerificationError` is only for misuse (verify without a store, malformed golden fixture).
- Bounded: exactly one corrective retry (no loop) → guaranteed termination. Judge/fallback both return a boolean, so aggregation always completes.
- Non-interactive safety: no TTY → never blocks on a prompt; uses `AGENT_VERIFY_AUTO_PULL` policy (default = fallback to general model). Tests always take the fallback path (deterministic, no network).

## 5. Testing (TDD)
- `tests/verification/claims.test.ts` — decompose + `[mem:<id>]` citation extraction (mock LLM); uncited claim → `citedIds:[]`.
- `tests/verification/judge.test.ts` — `verifyFaithfulness` aggregation + threshold (mock `checkClaim`); no-citation/missing-evidence claim → unsupported; `usedFallback` flag.
- `tests/verification/crag.test.ts` — grade routing + bounded single corrective (mock).
- `tests/verification/verify.test.ts` — end-to-end primitive with a mock store (`getByIds`) + mock judge: grounded answer → supported; planted hallucination → unsupported; no-citations → abstain-worthy.
- `tests/memory/getbyids.test.ts` — store returns the right chunks by id (real LanceDB, tiny table).
- `tests/crew/verify-wiring.test.ts` — a crew/task with `verify:true` compiles to answer→verify→branch→(corrective→verify₂)→abstain; unsupported → `{kind:'unverified'}` (mock models).
- `tests/verification/faithfulness.eval.test.ts` — the in-repo golden-set gate (general-model fallback path).
- `tests/integration/verification.live.test.ts` (skips if Ollama/MiniCheck absent) — real `bespoke-minicheck` catches a planted hallucination; a grounded answer passes.
- Regression: crews/workflows without `verify` are byte-for-byte unchanged (additive flag).

## 6. Out of scope (later)
CoVe · semantic-entropy/SEPs · self-consistency · external eval frameworks (RAGAS/Promptfoo/DeepEval) · NeMo/Guardrails-AI · generation-time inline citation · Self-RAG · unbounded CRAG loops · **the first-boot model provisioning + chunked downloader UX (Slice 14)** — this slice only adds the minimal consent-then-pull for the judge model.

## 7. Acceptance
- `bun run check` green (docs-check · typecheck · lint · test); live + eval-live tests skip cleanly without MiniCheck.
- `verify(answer,{query,space})` returns a `Verdict`; a grounded answer scores ≥ threshold, a planted hallucination scores below and lists the unsupported claims; an uncited/no-evidence answer abstains.
- A crew/workflow with `verify:true` (or `--verify`) auto-runs verification, does one bounded CRAG corrective on failure, and **abstains** (`{kind:'unverified'}` + `unverified.txt`) when still ungrounded — verified live end-to-end.
- MiniCheck absent → interactive consent-pull prompt; declined/non-interactive → general-model fallback with a logged notice (never hard-fails).
- New `src/memory` `getByIds`; `verification.check` spans render in `bun run runs`.
- `docs/architecture.md` gains a Verification section (passes `docs:check`); README + ROADMAP updated; Artifact regenerated (Verification node + a "verify" terminal-mode scenario).

---

### Standing notes (per repo CLAUDE.md)
- **Architecture-doc update:** new "Verification" section + `src/verification/` module-map node/edges (crew/workflow → verification → memory `getByIds` + judge model via Model Manager + telemetry); renumber On-disk/Testing/Glossary; README status/slice-13 row; ROADMAP grounded-verification marker → ✅ (Slice 13); regenerate the Artifact.
- **Telemetry to emit:** `verification.check` span with `ATTR.VERIFICATION_*` (supported, faithfulness, crag_grade, retries, fallback), nested under the crew/workflow step, rendered by `bun run runs`.
