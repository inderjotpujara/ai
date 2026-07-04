# Slice 20 — Verified "works out of the box" (design)

**Date:** 2026-07-04
**Phase:** D (self-extension) + folds in Phase-A's deferred telemetry+eval harness. **Closes Phase D.**
**Branch:** `slice-20-verified-works-out-of-the-box`
**Status:** design approved, spec authored.

Grounding research (validated 2026-07-04 against arXiv 2025–2026 + practitioner guides): see memory `reference-verified-works-out-of-the-box-findings`. Builds directly on Slice 17 (agent-builder), Slice 19 (crew/workflow-builder), Slice 13 (verification / `checkClaim` judge + golden-set pattern), Slice 12 (embeddings + LanceDB), Slice 14 (in-repo fit-selection eval pattern), Slice 8 (OTel spans).

---

## 1. Problem

A generated agent/crew/workflow is today only **structurally** valid (and, since Slice 19, **semantically judged** by a goal-alignment LLM check). It is never actually *run* before being handed to the user as a general guarantee. Slice 19's live-verify proved **one** hand-picked case end-to-end — not a repeatable, per-generation check. Three capabilities are missing entirely:

1. **Execution dry-run** — invoke the freshly-written artifact against a small representative task the moment it's created, before declaring success.
2. **Golden-eval** — a few `need → expected-behavior` cases per generated artifact, run before the build is called a success (mirrors the §12 verification golden-set pattern).
3. **Reuse / archive** — detect when a new need matches an already-generated artifact closely enough to reuse it instead of generating a near-duplicate; archive/prune artifacts that stop being used.

None exist. This slice adds all three as one **cheapest-first verification gate** and turns generation from *write-then-return* into **stage → verify → commit**, so nothing broken ever lands in the registry.

## 2. Approved decisions (from brainstorming)

- **D1 — Dry-run isolation = bounded real run.** Run the artifact for real against a benign, read-only representative task, bounded by a NEW wall-clock timeout + the existing step/depth/concurrency caps. Zero new deps; no Docker. Side-effects mitigated by choosing a read-only representative task.
- **D2 — Verify posture = stage → verify → commit (hard gate).** Transpile/render to a staging path (NOT the registry), verify, and only splice into the `agents/`·`crews/`·`workflows/` index on pass. Failure discards the staged file and reports the error/scores. A `--force` escape hatch commits anyway (marked `unverified`).
- **D3 — Judge + degrade = degrade-to-runs-verified.** The golden-eval judge must be a capable model (~26–30b, different family from the generator). If none clears the bar, SKIP behavioral golden-eval, commit marked `verified: runs (behavior unchecked)`, never block, and offer (consent-gated) to pull a bigger judge. Matches standing `feedback-consent-before-model-pull` + `selector-providererror-fallback` (degrade-never-crash).
- **D4 — Reuse = detect-and-confirm.** Cosine over a capability signature: **≥0.85 → reuse (confirm)**, **0.75–0.85 → offer reuse/adapt**, **<0.75 → generate new**. Propose-and-consent, consistent with the whole builder family. Thresholds computed live / env-overridable, and calibrated by an in-repo eval (local embedders compress the cosine range).
- **D5 — Archive = usage-telemetry-driven, archive-not-delete.** Derive last-used / use-count / last-eval-pass from `spans.jsonl`; archive (move aside + unregister, reversible) an artifact with no successful invocation in N days AND a more-used live near-duplicate.

## 3. Architecture

New subsystem **`src/verified-build/`**, called by both builders through a single `gate.ts` entry. Cheapest-first pipeline:

```
build*(need, deps)
  ── stage 0: REUSE CHECK (before generation) ──────────────────────
     signature = signatureFromNeed(need)         // purpose + likely tools
     decision  = reuseDecision(signature, manifest)   // cosine bands
       reuse    → return { kind:'reused', name }        (no generation)
       offer    → confirm; if accepted → reuse; else generate
       generate → fall through
  … existing generate → validate → consent (unchanged) …
  … resolve-members (crew-builder only, unchanged) …
  ── stage 1: STAGE ────────────────────────────────────────────────
     transpile/render → atomicWrite to a STAGING path (tmp dir), not the index
  ── stage 2: STRUCTURAL ───────────────────────────────────────────
     parse + import + existing validateIR/validateProposal      (mostly exists)
  ── stage 3: DRY-RUN (bounded real run) ───────────────────────────
     task = representativeTask(need, signature)   // benign / read-only
     res  = withWallClock(DRY_RUN_MS, () => run{Agent,Crew,Workflow}(def, task, deps))
       fail → self-repair loop (≤ MAX_REPAIRS, computed): feed the REAL runtime
              error back to the generator, re-stage, re-run
  ── stage 4: GOLDEN-EVAL (behavioral) ─────────────────────────────
     judge = selectJudge()                        // largest-local, diff family
       judge below bar → skip; verifiedLevel = 'runs'; offer judge pull
     cases = generateGolden(need, signature)      // 3–7 binary cases
     score = evalCases(def, cases, judge, deps)   // temp0, ≥3× unanimous, rubric-binary
       pass → verifiedLevel = 'behaves'
       fail → FAIL
  ── COMMIT ────────────────────────────────────────────────────────
     pass → splice staged file into index (existing registerInIndex),
            write <name>.golden.json, upsert manifest entry
     fail → discard staged file; report; (--force commits, verifiedLevel='unverified')
```

The gate never throws for a verification failure — it returns a discriminated `VerificationResult`; the builders translate it into their existing `BuildResult`/`CrewBuildResult` unions (new variants below).

### 3.1 Module layout (`src/verified-build/`)

| File | Responsibility |
|---|---|
| `types.ts` | `VerifiedLevel` (enum: `Behaves`/`Runs`/`Unverified`), `VerificationResult`, `ReuseDecision`, `CapabilitySignature`, `GoldenCase`, `DryRunResult`, `EvalResult`, `ManifestEntry`, deps types. |
| `signature.ts` | `signatureFromProposal(p)` / `signatureFromIR(ir, shape)` / `signatureFromNeed(need, model)` → `CapabilitySignature { purpose, tools[], modelTier, io, roles[] }`. `signatureText(sig)` → canonical, **purpose-forward** string to embed. **Symmetry rule:** both stored entries and the pre-generation reuse query embed via the *same* `signatureText`; because reuse runs before generation, its query goes through `signatureFromNeed` (purpose = cleaned need, tools = best-effort/empty), and `signatureText` weights `purpose` first so the need-derived query and a proposal-derived stored signature remain comparable. Tool overlap is a secondary re-rank signal, not the primary axis. |
| `reuse.ts` | `reuseDecision(sig, manifest, deps)` → `{ kind:'reuse'|'offer'|'generate', match?, similarity }`. Uses `embedOne(signatureText(sig))` + `cosine` against each entry's stored `vector`; tie-breaks by tool-set overlap + usage/eval-pass (Trust-Fabric-style rank). Bands from config. |
| `dry-run.ts` | `dryRun(def, kind, task, deps)` → `DryRunResult { ran, output?, error? }`. Wraps run fns in `withWallClock`. `representativeTask(need, sig)` chooses a benign task. |
| `repair.ts` | `repairLoop(stageAndRun, error, deps)` — ≤ `MAX_REPAIRS` (computed) attempts, feeds the real error back to the generator via the `BuilderModel` seam. |
| `golden.ts` | `generateGolden(need, sig, model)` → `GoldenCase[]` (Auto-Eval-Judge decomposition). `loadGolden(path)` / `appendGolden(path, case)` (living dataset). |
| `eval.ts` | `evalCases(def, kind, cases, judge, deps)` → `EvalResult { passed, perCase[] }`. Judge protocol (temp0, ≥3× unanimous, rubric-binary). Reuses `checkClaim` for the groundedness sub-metric. |
| `judge.ts` | `selectJudge(deps)` → `{ model, tier, belowBar }`; degrade + consent-gated pull offer. Different-family-from-generator preference. |
| `gate.ts` | `verifyAndCommit(staged, ctx, deps)` — orchestrates stages 1–4 + commit/rollback. The single entry both builders call. |
| `manifest.ts` | `readManifest(dir)` / `upsertEntry(dir, entry)` / `rebuildFromArtifacts(dir)` — the per-registry sidecar (§3.2). |
| `usage.ts` | `aggregateUsage(runsRoot)` → per-artifact `{ lastUsedMs, useCount, lastEvalPass }` from `spans.jsonl`; folds into manifest. |
| `archive.ts` | `archiveDecision(manifest)` → candidates; `archiveArtifact(dir, name)` (reversible move + unregister). |
| `config.ts` | Live-computed thresholds + env fallbacks (no hardcodes): `DRY_RUN_MS`, `MAX_REPAIRS`, reuse bands, judge capability bar, archive idle-days. |

### 3.2 Data-model additions (close two existing gaps)

**Per-registry manifest sidecar** — `agents/.generated.json`, `crews/.generated.json`, `workflows/.generated.json`:

```jsonc
{
  "version": 1,
  "entries": {
    "<name>": {
      "need": "the original NL request",       // GAP CLOSED: need was never persisted
      "signature": { "purpose": "...", "tools": ["..."], "modelTier": "...", "io": "...", "roles": ["..."] },
      "vector": [/* embedding of signatureText(signature) — the reuse-cosine axis (see Symmetry rule, §3.1) */],
      "verifiedLevel": "behaves" | "runs" | "unverified",
      "goldenPath": "agents/<name>.golden.json",
      "createdAtMs": 0,
      "lastUsedMs": 0,      // GAP CLOSED: no usage tracking existed
      "useCount": 0,
      "lastEvalPass": true
    }
  }
}
```

This one structure serves all three pillars: reuse reads `vector`; archive reads `lastUsedMs`/`useCount`; both read `need`. It is a **cache** — rebuildable from artifacts + spans (`rebuildFromArtifacts` + `aggregateUsage`), consistent with the repo's "runs are the ledger" philosophy. Tracked in git alongside the artifacts.

**Per-artifact golden set** — `<name>.golden.json` next to the artifact, a living regression suite:

```jsonc
{ "need": "...", "cases": [ { "id": "c1", "input": "...", "assert": "must produce N bullet points", "kind": "task-success" | "grounded" | "routing" } ] }
```

### 3.3 Two net-new primitives

- **Wall-clock bounding** — `src/core/agent.ts` (`runAgent`) gains an optional `abortSignal` threaded into `generateText` (AI SDK supports it; not passed today). `src/verified-build/dry-run.ts` provides `withWallClock(ms, fn)` = `Promise.race([fn(), timeout(ms)])` at the run boundary as the outer guard. `DRY_RUN_MS` computed from observed model speed, env-overridable (`AGENT_DRY_RUN_MS`).
- **`embedOne(text)` + exported `cosine`** — thin convenience in `src/memory/` over the existing embedder and the currently module-private `cosine` in `chunk.ts` (export it). No new store; embeds a single string for reuse comparison.

## 4. Builder integration (stage → verify → commit refactor)

Both builders currently: `… consent → write{Agent,CrewOrWorkflow}() → return {kind:'written'}`. New flow:

- **agent-builder** (`src/agent-builder/builder.ts`): after consent, call `gate.verifyAndCommit(...)` with a *stage* function (render to tmp) + a *commit* function (existing `writeAgent`/`registerInIndex`). `BuildResult` gains variants: `{ kind:'reused'; name }`, `{ kind:'failed-verification'; stage; detail }`. The `written` variant gains `verifiedLevel`.
- **crew-builder** (`src/crew-builder/builder.ts`): same, after `resolveMissingAgents` + `transpile`. `CrewBuildResult` gains the same variants. Reuse check runs at the top (the `existingCrews()`/`existingWorkflows()` deps that exist but are unused today).

`writeAgent` / `writeCrewOrWorkflow` are refactored to separate **render** (pure string) from **register** (index splice) so staging can render without touching the index. Atomicity + marker assertions preserved.

## 5. Surfaces

- **CLI:** verification runs inline in `bun run agent-builder` / `bun run crew-builder` (progress + final `verifiedLevel`). `--force` commits on failure. New `bun run archive [--prune]` — reports reuse clusters + archive candidates, prunes with confirmation.
- **Chat:** the existing build offers surface a reuse hint ("I already have `web_fetch` that does this — reuse it?") before offering to build.

## 6. Testing strategy

- **Deterministic (fake-model) unit tests** per module: signature extraction, cosine bands, reuse decision, manifest read/upsert/rebuild, usage aggregation from a fixture `spans.jsonl`, archive decision, dry-run wall-clock (fake slow run → timeout), repair loop (fail-then-fix), golden generation shape, eval scoring + unanimous-3× logic, judge degrade path, gate stage→verify→commit + rollback-on-fail + `--force`.
- **In-repo calibration eval** (`tests/verified-build/reuse.eval.test.ts`, mirrors Slice-14 fit-selection eval): labeled signature pairs from our own library → asserts the chosen cosine bands separate reuse/generate correctly for our local embedder.
- **LIVE-VERIFY (merge gate, Ollama):** full gate end-to-end — (a) a genuinely-good need generates → dry-runs → evals → commits `behaves`; (b) a deliberately-broken generation → repair loop → either recovers or is rejected (staged file discarded, index untouched); (c) a near-duplicate need → reuse decision fires. Behavioral judge on the largest installed model; degrade path exercised by forcing a small judge.

## 7. Deliberate scoping calls (delivered complete — not deferred debt)

- **Plain cosine over capability signatures, not SimHash fingerprinting.** SimHash/Hamming is a large-population optimization; our registry is single-digit, so cosine fully delivers reuse. Noted as a future scale lever, not owed debt.
- **Judge protocol shipped; formal Cohen's-κ-vs-human-labels not.** κ-calibration needs a human-labeled set we don't have. Instead we ship the protocol (temp0, ≥3× unanimous, different-family, rubric-binary) + the in-repo threshold-calibration eval. Recorded honestly in docs.
- **Representative-task selection is heuristic** (read-only/benign task derived from the need + signature), not a full task-synthesis model. Sufficient for a smoke test; the behavioral judgment is the golden-eval's job.

## 8. Standing notes (required by the hard line)

- **Architecture-doc update:** new **§20 "Verified build"** section in `docs/architecture.md` (module map + data-flow: builder → gate → {reuse, structural, dry-run, golden-eval} → commit/manifest); a **`verified-build` node + edges** in the Mermaid module map (→ agent-builder, → crew-builder, → memory/embedder, → verification/`checkClaim`, → telemetry, → registries/manifest); README Status line + slice table row (Slice 20 ✅) + feature paragraph; ROADMAP markers flipped (gap table + phase table + recommended sequence: the three "works out of the box" rows → ✅ shipped Slice 20; Phase D → complete); the **snapshot Artifact regenerated** (new node/edges, footer slice+test counts). SDD ledger appended per task.
- **Telemetry to emit:** a `build.verify` span (child of `agent.build`/`crew.build`) with per-stage events (`reuse`, `structural`, `dry_run`, `dry_run_repair`, `golden_eval`) and attributes: `verify.reuse.decision`, `verify.reuse.similarity`, `verify.dry_run.ran`, `verify.dry_run.repairs`, `verify.judge.model`, `verify.judge.below_bar`, `verify.golden.passed`/`.total`, `verify.level`. A separate `build.archive` span (`archive.candidates`, `archive.pruned`). New keys added to the `ATTR` registry in `src/telemetry/spans.ts`, `gen_ai.*` conventions preserved.

## 9. Out of scope / explicitly deferred

- SimHash fingerprinting at scale (see §7).
- Human-labeled κ calibration (see §7).
- Cross-run automatic golden-set growth from production failures beyond the append primitive (the mechanism ships; an automatic feedback wiring is future).
- Anything on the locked sequence past Slice 20 (Slice 21 graceful-degradation, etc.).
