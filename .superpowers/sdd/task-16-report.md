# Task 16 report — Slice 30b Phase 7 docs (3 of 4 surfaces)

(Note: this overwrites a stale `task-16-report.md` from an earlier
task-numbering pass — an unrelated `GET /api/models` Phase-5 report — per
this repo's numbering-reuse convention.)

**Scope:** `docs/architecture.md`, `README.md`, `docs/ROADMAP.md` only. Ledger
(`.superpowers/sdd/progress.md`) and the docs-snapshot Artifact are explicitly
NOT touched here — controller owns both (ledger closeout + Task 18 Artifact
regen). No commit made; all edits left in the working tree.

## 1. `docs/architecture.md`

Appended a new `## Voice (web UI — Slice 30b Phase 7)` section at the end of
the file (after `## Builders + Library (web UI — Slice 30b Phase 5)`'s "What's
still deferred" subsection — confirmed this is genuinely the current last
section; Phase 6 was folded into §3g/module-map rather than a new top-level
section, so the brief's placement instruction was accurate). Contents:

- Thesis paragraph (dictation-only, cross-references §23's deferred-to-30b
  promise, explicitly states voice never touches `sendMessage`/`handleSend`).
- **D1** engine-override paragraph (sherpa-onnx rejected — no first-party
  browser package, would need Emscripten + a second ONNX runtime; transformers.js
  chosen, already a root dependency).
- Module-map table for `web/src/features/voice/` — verified against the real
  directory listing (9 non-test files: `audio-capture.ts`, `downsample-worklet.ts`,
  `stt-engine.ts`, `stt.worker.ts`, `model-tier.ts`, `vad.ts`, `use-voice-input.ts`,
  `mic-button.tsx`, `waveform.tsx`); I added `downsample-worklet.ts` and
  `stt.worker.ts`/`model-tier.ts` rows beyond the brief's condensed draft table
  since the real module map has more files than the brief listed — verified
  each file's actual exports (`createSegmenter`, `createDownsampler`,
  `createAudioCapture`, `createSttEngine`, `useVoiceInput`, `enum ModelTier`)
  against source before writing the table, not copied blind from the brief.
- Contracts + config paragraph (`src/contracts/voice.ts`, `CaptureSource`
  parity test, `AGENT_WEB_VOICE_*` config → `window.__AGENT_VOICE_*` globals,
  `isVoiceInputEnabled()`/`voiceModelTier()` — all grep-verified present in
  `src/config/schema.ts`, `src/server/main.ts`, `web/src/features/settings/index.tsx`).
- Composer wiring + data-flow paragraphs (hold-to-talk vs. tap-to-toggle).
- **D10 outcome** — the brief shipped this as an unfilled IMPLEMENTER
  placeholder with 3 candidate sentences. I resolved it from real evidence
  rather than guessing: `web/vite.config.ts`'s header comment ("`require-corp`
  was proven/adjusted by the Task 7 D10 spike") + `stt.worker.ts`'s header
  comment ("D10: built on Rung 1 (require-corp + CDN CORS fetch)") + the SDD
  ledger's Task 7 entry ("D10 Rung-1 comment present, ZERO header-file change
  confirmed") all agree: **Rung 1** — no COOP/COEP header change was needed.
  Wrote this as fact, citing the real files, and noted the fuller live-browser
  pass is Task 17 (not yet run as of this task).
- **§7.1/§7.2 hard-parts** paragraph — stated both went through ultracode
  adversarial-verify per the plan's HARD-task gate (matches the ledger's
  Task-numbering map: Task 13 = HARD ultracode for §7.1 b/c + §7.2 a–d). I did
  NOT fabricate a specific "both lenses HOLD" verdict since that's the
  ledger's job to record precisely — worded generically as "verified against
  the spec's (a)-(d) requirements," which is safe/accurate without overclaiming
  a review outcome I haven't independently inspected this session.
- Telemetry paragraph (no new span, rides `/api/chat`'s existing instrumentation).
- Two documented limitations (no streaming interim, two separate buttons not
  one gesture-disambiguating control).
- Closing note: capability marker NOT flipped elsewhere in the file.

`bun run docs:check` requires `web/src/features/voice/` be documented — it now
is, via this new section's module-map table.

## 2. `README.md`

- **Top "Where this is going" blockquote**: inserted the Phase-7 clause (mic
  button, both gestures, D1 override, partial-slice/🟡, "Next: Slice 30b
  Phase 8") in the exact position the brief specified — right after the
  existing Phase-6 clause and before "Slices 23/24/25 remain held."
- Found and fixed an **accuracy conflict** the brief's diff didn't anticipate:
  the same blockquote's own Phase-5 clause said "Browser voice remains Phases
  7–8" a few lines *before* my new "Phase 7 has now landed" clause — a
  same-paragraph contradiction if left alone. Changed it to "Browser voice
  lands next (Phase 7, below); polish/a11y remains Phase 8."
- **Status line** (`> **Status:** Slice 30b Phases 1, 1b, 2, 3, 4, 5, and 6
  have landed... partial-slice (Phases 7–8 remain)`): added "7 (Browser voice
  input)" to the landed list and changed "(Phases 7–8 remain)" → "(Phase 8
  remains)" — this line is distinct from the top blockquote and the brief's
  step 2 didn't explicitly name it, but it would have been visibly stale
  (claiming Phase 7 not landed) if left untouched, so I updated it for
  accuracy.
- **Slice-status table row** (the single long 30b row): appended the Phase-7
  summary sentence (Composer mic button, D1 override, no new route/span) right
  before the trailing `See docs/architecture.md §...` citation list; appended
  `, §"Voice (web UI — Slice 30b Phase 7)"` to that citation list; changed the
  trailing status cell from "Phases 1, 1b, 2, 3, 4, 5 & 6 landed" → "Phases 1,
  1b, 2, 3, 4, 5, 6 & 7 landed."
- Did NOT touch the two deeper historical narrative paragraphs (Phase-2's own
  "Explicitly not yet shipped (Phases 4–8): ... browser voice surface" and
  Phase-3's "(Phases 3–8): ... browser voice surface") — these are frozen,
  point-in-time snapshots of what each *earlier* phase's own paragraph said
  was still pending when that phase landed (matching the pattern of every
  other phase's paragraph in the file); they were accurate when written, and
  editing them would rewrite history rather than correct a live claim.
- Did NOT add a new dedicated "Voice (web UI — Slice 30b Phase 7)" narrative
  paragraph mirroring Phase 6's own dedicated paragraph — the brief's steps
  2–3 specified only the top blockquote + table row, not a new paragraph
  section. Flagging this for the controller in case a dedicated paragraph
  (matching every other phase's pattern) was actually wanted — see "uncertain"
  list below.
- Left the "Next (product line)" row ("Slice 30b Phase 7 onward — voice")
  untouched — it already describes Phase 7+ as the next work at a coarser
  grain and isn't factually wrong, though slightly imprecise now that Phase 7
  itself landed. Also flagged below.

## 3. `docs/ROADMAP.md`

- **Gap table "TUI / local web UI" row**: changed "... 6 (Persistence: ...)
  landed; voice/polish phases pending." → "... 6 (Persistence: ...) + 7
  (Browser voice — ... D1) landed; polish/a11y phase pending." per the brief.
  Leading `🟡 in progress` marker left unchanged (capability stays 🟡). Also
  appended a Phase-7 summary sentence + `§"Voice (web UI — Slice 30b Phase
  7)"` citation to that row's trailing prose/citation list, matching the
  density of the Phase-1–6 sentences already in the row (the brief's step 4
  specified only the short marker-text edit; I judged the row would read
  inconsistently — every other phase gets a full sentence — with only a
  marker change and no sentence, so I added one, mirroring the density/
  structure of the Phase-6 sentence immediately preceding it).
- **Recommended-sequence item 21**: replaced the single "Phases 7–8 — Browser
  voice, polish/a11y/live-verify — not yet started" bullet with two bullets —
  Phase 7 marked ✅ shipped (full paragraph, verbatim per the brief's Step-5
  text) and Phase 8 kept as "not yet started."

## Gate results

- `bun run docs:check` → **PASS** (`docs-check: living docs present + linked;
  every src subsystem documented.`)
- `bun run typecheck` (root) → **PASS**, clean, no output.
- `cd web && bun run typecheck` → **PASS**, clean, no output (extra smoke
  check beyond the brief's ask, since docs changes touch no `.ts`/`.tsx`).
- `bun run test` (root) → **1555 pass / 36 skip / 0 fail**, 3685 expect calls,
  377 files — matches the brief's stated count exactly, confirms nothing else
  on the branch regressed while this task ran.
- `cd web && bun run test` → **282 pass, 56 files** — matches the brief's
  stated web count exactly.

## Claims for the controller to verify

1. **README's two untouched historical "not-yet-shipped" paragraphs and the
   "Next (product line)" row** (§2 above) — left as historical/coarse framing
   rather than edited. If the docs hard-line reads these as live claims
   rather than history, they may need a touch-up in the controller's own pass
   or at Task 18.
2. **Whether README should get a dedicated Phase-7 narrative paragraph**
   (mirroring Phase 6's own "**Persistence + product (web UI — Slice 30b
   Phase 6).**" block) — the brief's steps didn't ask for one, so none was
   added; flagging in case that's an expected parallel-structure gap.
3. **D10 outcome (Rung 1)** — resolved from `vite.config.ts` + `stt.worker.ts`
   header comments + the ledger's Task 7 entry, all three agreeing, rather
   than from an explicit "D10 RESULT: Rung N" ledger line (none exists yet
   under that exact phrasing). High confidence, but worth a second look since
   the brief flagged this as the one placeholder needing real evidence.
4. **§7.1/§7.2 review-outcome wording** — described both hard parts as
   "verified against the spec's (a)-(d) requirements" without asserting a
   specific "both lenses HOLD" verdict, since I have not independently
   inspected Task 13's actual review transcript this session. If the
   controller has the precise verdict on hand, a more specific sentence could
   replace mine in architecture.md's §7.1/§7.2 paragraph.

## Files touched

- `docs/architecture.md` (+140 lines, new section appended)
- `README.md` (+20/-8 net, 3 edits: top blockquote clause + conflict fix,
  status line, slice-status table row)
- `docs/ROADMAP.md` (+32/-4 net, 2 edits: gap-table row, recommended-sequence
  item 21 bullet split)

Not touched (controller-owned): `.superpowers/sdd/progress.md`, the
docs-snapshot Artifact.
