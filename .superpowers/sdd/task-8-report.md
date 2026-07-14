# Task 8 report: architecture docs + CI-greening + full gate

(Note: this file name was previously used by an earlier Phase-1 Task 8,
media-path confinement — that work is safely preserved in git history
at commit 590365b on `slice-30b-local-web-ui`. This report is for the
current, final Phase-1b Task 8: architecture docs + CI-greening + full
gate.)

## Status: COMPLETE

## Commits (3, conventional, on `slice-30b-phase1b-frontend`)

1. `bf9e2c6` — `fix(media): inject selectModel seam so speech tests are CI-deterministic`
   File: `tests/media/consent-label.test.ts`
2. `95cd7d8` — `ci: run the full bun run check (incl. web workspace gate)`
   File: `.github/workflows/ci.yml`
3. `2ea6fb5` — `docs(architecture): web/ frontend scaffold (Slice 30b Phase 1b)`
   File: `docs/architecture.md`

## Deliverable A — `docs/architecture.md`

- Added a **Web frontend (browser UI scaffold — `web/`, Slice 30b Phase 1b)** section, placed immediately after the existing **Server (web BFF — `src/server/`, Slice 30b Phase 1)** section (end of file), matching that section's Feature/Mechanism-style prose (here: Feature / Structure / Design system / Contract boundary / Transport port / Testing / Explicitly NOT yet built).
- Added a **Web frontend** row to the main module table (`Layer | Files | Responsibility | Knows about`, right after the existing Server row) pointing to "full section below" — same convention Contracts/Server use.
- Content is scaffold-only and truthful: documents the Bun workspace layout (`web/src/main.tsx`, `app/` shell + `router.tsx` + `command-palette.tsx`/`commands.ts`, `shared/{design,contract,transport,ui}`, `features/*` stubs + isolation rule), the Blueprint-Mono token system (light+dark, reduced-motion, Geist/Fontsource), the contract client (`window.__AGENT_TOKEN__` → `Authorization: Bearer` → zod-parse against `@contracts`), the transport-port interface (`ChatTransport`/`RunStream`, interface only), and the `check:web` Vitest lane folded into `bun run check`.
- Explicitly states what is **NOT** built: live SSE/`useChat` streaming, real feature screens, `@visx`/`@xyflow`, persistence, voice — all deferred to Phases 2–8. No claim of chat/streaming working.
- I verified every path/file claim against the actual `web/src/` tree (`find`) before writing it — corrected one initial error (`main.tsx` is at `web/src/main.tsx`, not `web/src/app/main.tsx`).
- No mermaid diagram was extended: the existing Contracts/Server sections (which this new section mirrors) are likewise **not** represented in the system-map mermaid diagram or in any diagram of their own — only in the module table + their own prose section. Followed the same, already-established precedent rather than inventing a new diagram convention.
- Did not touch `docs/README.md` (doc map) — `web/` isn't a new *living doc file*, it's a new subsection of the existing `architecture.md`, so the doc-map/README-pointer rule (only for new/renamed living docs) doesn't apply.

## Deliverable B — `tests/media/consent-label.test.ts` (media-candidate repos chosen)

Root cause confirmed: the two `generate_speech` clone-consent tests (declined + granted) and the third (`default Kokoro needs no consent`) all injected `spawn` but not `selectModel`, so `createGenerateTools`'s `select` fell back to the real `selectGenModel(Audio)`, which returns `undefined` on the model-less CI runner (no `.wav` path — the graceful-degrade message instead), failing the `toMatch(/\.wav$/)` assertions non-deterministically depending on the host's installed models.

Fix: added a `fakeAudioCandidate(repo)` helper (mirrors `tests/media/generate-tools.test.ts`'s `fakeCandidate(kind, engine)`, parameterized by `repo` since these tests assert on `requiresCloneConsent`, which classifies by repo/model name) and injected `selectModel: async () => fakeAudioCandidate(<repo>)` into **all three** `generate_speech` tests that exercise a real generation path:

- **Clone-consent tests (declined + granted):** `repo: 'mlx-community/csm-1b'` — the real catalog entry (`src/media/generate/catalog.ts` `GEN_CATALOG`) for the Sesame CSM-1B voice-clone model. `requiresCloneConsent` matches the `csm` substring (`src/media/consent.ts` `CLONE_MODEL_PATTERN = /(csm|dia|xtts|fish)/i`) → `true`, so `resolveVoiceModel(opts)` (which returns `opts.model` = the injected `candidate.repo`, taking precedence over `AGENT_VOICE_MODEL`) resolves to a model that correctly triggers the consent gate — matching the test's existing `AGENT_VOICE_MODEL='csm-1b'` intent and the `askCloneConsent` assertions (declined → no spawn, "consent declined" message; granted → `.wav` result).
- **Default-Kokoro test:** `repo: 'mlx-community/Kokoro-82M-bf16'` — the real catalog entry for Kokoro. `requiresCloneConsent` returns `false` for it (no substring match), so the consent gate is skipped entirely; `askCloneConsent` is left as a throwing stub, which passing proves it's never invoked.

All `.wav` assertions (`toMatch(/\.wav$/)`) and the "consent declined" / spawn-not-called assertions were preserved unchanged — no assertion was weakened.

**Verification:** `bun test tests/media/consent-label.test.ts` → `9 pass, 0 fail, 19 expect() calls`.

## Deliverable C — `.github/workflows/ci.yml`

Replaced the four granular steps (`docs:check`, `typecheck`, `lint`, `bun test`) with a single `- run: bun run check` step. Kept `actions/checkout@v4` + `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`. Updated the header comment to state CI now runs the exact same gate as `bun run check` locally (docs:check && typecheck && lint && check:web && test), including the `web/` workspace typecheck + Vitest suite, and that this keeps CI and the local gate from drifting apart. Cannot run GitHub Actions locally; verified by equivalence via a green `bun run check` (see gate 3 below) since that is now the literal command the workflow runs.

## Gate outputs

**1. `bun test tests/media/consent-label.test.ts`** (deliverable B, run first, standalone):
```
9 pass
0 fail
19 expect() calls
Ran 9 tests across 1 file. [186.00ms]
```

**2. `bun run docs:check`** (deliverable A):
```
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```
(Also re-verified implicitly by the pre-commit hook on each of the 3 commits above — same pass output each time.)

**3. `bun run check`** (whole local gate — this is also the exact command `ci.yml` now runs):
- `docs:check` ✔ (passed silently, chain continued)
- `typecheck` ✔ (passed silently, chain continued — no errors printed)
- `lint` ✔ — one real Biome finding was caught and fixed during this task (an import-order violation introduced by my own edit to `consent-label.test.ts`, fixed by reordering the `MediaVenv` import before the `consent.ts` import); final run: **0 errors** (14 pre-existing warnings in unrelated files — `noExplicitAny` in `tests/provisioning/provisioner.test.ts` and `tests/resource/ollama-control.test.ts` — are warnings, not errors, and predate this task; the lint script only fails the gate on `Found N error`, and the final run reported none)
- `check:web` ✔ — `Test Files 9 passed (9)`, `Tests 26 passed (26)` (matches the brief's expected "26 Vitest" count exactly)
- `test` (root, path-ignoring `web/**`) ✔ — `1161 pass`, `36 skip`, `0 fail`, `2743 expect() calls`, `Ran 1197 tests across 294 files` (the 36 skips are pre-existing environment-gated live-model tests, unrelated to this task)

**Final verdict: full gate green.**

## Self-review

- Spec coverage: all three deliverables (A/B/C) implemented per the brief's Step 0a/0b/1, verified via Step 2/3, committed via Step 4 exactly as specified (3 commits, same messages/grouping the brief prescribed).
- Consent-semantics mapping double-checked against source (`src/media/consent.ts` `CLONE_MODEL_PATTERN`, `src/media/generate/catalog.ts` `GEN_CATALOG`) before writing the fix — not guessed.
- No `.wav` assertion weakened; no test assertion removed or changed in meaning — only a `selectModel` seam was added to remove non-determinism.
- No repo-wide config changes beyond `ci.yml` (verified via `git status` — only the 3 target files were staged/committed by this task; other pre-existing unstaged files — SDD ledger `progress.md`, task briefs/reports, `.remember/now.md` — were already modified before this task started and are out of scope for Task 8, so left untouched).
- Architecture-doc claims were checked against the actual `web/src/` tree with `find` before writing, not assumed from the brief's bullet list verbatim — caught and fixed one path inaccuracy (`main.tsx` location) during drafting.
- docs:check passed on every commit via the pre-commit hook (no bypass, no `DOCS_OK=1` used).

## Concerns

- None blocking. Two minor, non-blocking notes:
  1. The repo currently has unrelated uncommitted changes (SDD ledger `progress.md`, `.remember/now.md`, and several `task-N-brief.md`/`task-N-report.md` files) predating this task's start — left untouched per the instruction to make no repo-wide changes beyond the three named files. Whoever lands this branch on `main` should reconcile/commit those separately (the pre-push slice-landing gate will want the SDD ledger updated before merge to `main`, per this repo's CLAUDE.md hard line — that is out of scope for Task 8 itself but worth flagging before the final land step).
  2. The `ci.yml` change is verified by equivalence (green `bun run check` locally) rather than an actual GitHub Actions run, per the brief's own acknowledgment that this can't be run locally — this is the intended verification method, not a gap, but noting it since GitHub's cloud runner (Linux, no installed models) is still the true CI environment.
