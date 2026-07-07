# Task 10 — Slice 28 whole-branch review fix wave

Applied all three fixes from the review, added covering tests, and ran the
gates. Branch: `slice-28-hardware-adaptive-gen`.

## FIX A [correctness] — rank gen candidates by footprint bytes, not params

**File:** `src/media/generate/select.ts`

- `selectGenModel`'s ranking step (`fitting = withBytes.filter(...).sort(...)`)
  now sorts descending by `bytes` (computed via `weightsBytes`) instead of
  `c.footprint.approxParamsBillions`. Previously, same-param quant tiers
  (e.g. the real catalog's FLUX 4bit vs 8bit — both `approxParamsBillions: 12`)
  tied on params and the sort kept the first-listed entry (4bit) even when the
  8bit build also fit the budget with room to spare.
- Updated the function's docstring to describe ranking "by footprint bytes"
  and explain why (ties same-param quant tiers) instead of "by footprint"
  generically.

**Covering test:** `tests/media/gen-select.test.ts` — new test
`'ranks by footprint bytes, not params: same-param quant tiers do not tie'`.
Two same-param (12B) image candidates, `flux-4bit` (bytesPerWeight 0.55,
listed first) and `flux-8bit` (bytesPerWeight 1.1):
  - budget fits both (20 GB budget; 4bit ≈7.9 GB, 8bit ≈15.8 GB) → asserts
    `flux-8bit` is chosen (larger bytes / better fidelity wins).
  - budget fits only the 4bit (10 GB budget) → asserts `flux-4bit` is chosen.

## FIX B [robustness] — generation tools return a graceful message on ANY failure, never throw

**File:** `src/media/generate/tools.ts`

- Wrapped `await job.result()` in try/catch in all three tools
  (`generate_image`, `generate_speech`, `generate_video`). On rejection, each
  now returns a graceful string instead of letting the rejection propagate
  out of `execute`:
  - `` `Image generation failed (${message}). Image was not generated.` ``
  - `` `Speech generation failed (${message}). Speech was not generated.` ``
  - `` `Video generation failed (${message}). Video was not generated.` ``
  (message = `err instanceof Error ? err.message : String(err)`)
- Updated the `createGenerateTools` docstring to state the graceful-message
  contract now covers *every* failure mode (missing engine CLI, unreachable
  ComfyUI server, any other `job.result()` rejection) — not just the no-fit
  case.

**Covering test:** `tests/media/gen-tools-wiring.test.ts` — new test
`'generate_image returns a graceful message (never throws) when the engine itself fails'`
in a new `describe('createGenerateTools engine-failure degrade')` block.
Injects `selectModel` returning a valid candidate plus a `spawn` whose child
`onExit` fires with a non-zero code (mirrors `adapter.ts`'s
`runOneShotJob`, which rejects `job.result()` with
`generation failed (exit <code>)` on a non-zero exit). Asserts the tool
returns a string (never throws) containing both "failed" and "not generated".

## FIX C [docs] — finish the ROADMAP renumber + fix an overstated header

**File:** `docs/ROADMAP.md`

1. Recommended-sequence duplicate ordinal: item "21. Multi-machine + A2A
   interop (Phase E, Slice 30 — last)" renumbered to
   **"22. Multi-machine + A2A interop (Phase E, Slice 31 — last)"** (item 21
   is now uniquely the TUI / local web UI, Slice 30).
   Also updated the Slice-24 daemon note: "Distinct from Slice 30's
   multi-machine delegation and A2A" → "Distinct from **Slice 31's**
   multi-machine delegation and A2A."
2. Backlog item 34 referenced "Slice 29's TUI" and "Slice 29 (TUI
   groundwork)" — TUI is Slice 30 (Slice 29 = voice/streaming). Both fixed
   to "Slice 30's TUI" / "Slice 30 (TUI groundwork)".
3. Gap-flip header (~line 456, was "✅ `Capability.{ImageGen,SpeechGen,
   VideoGen}` now DRIVE a parallel gen-fit selector") reworded to:
   "✅ Hardware-adaptive generation via a parallel gen-fit selector, keyed on
   `MediaKind` (Slice 28)" — and the body now explicitly states the selector
   is keyed on `MediaKind`, not `Capability`, and that the
   `Capability.ImageGen/SpeechGen/VideoGen` enum values from Slice 27 stay
   typed-but-unconsumed. This matches the accurate body that was already
   there (which admitted the enums aren't consumed) instead of contradicting
   it via an overstated header.

**Grep confirmation (post-edit):**

```
$ grep -n "^[0-9]\+\. " docs/ROADMAP.md   # recommended-sequence ordinals
... 20. Voice in/out ... (Slice 29)
    21. TUI / local web UI ... (Slice 30)
    22. Multi-machine + A2A interop ... (Slice 31 — last)
# no duplicate ordinals — each 1..22 appears exactly once

$ grep -n "Slice 30" docs/ROADMAP.md
313: 21. TUI / local web UI (Phase F, Slice 30) — ...            [correct: TUI IS Slice 30]
333: ### Backlog beyond Slice 30 (proposed 2026-07-05, not yet locked)   [correct: sequence boundary]
350: | 34 | ... Slice 30's TUI covers run-history ... Slice 24 (daemon), Slice 30 (TUI groundwork) ... |  [correct: TUI]
# no remaining "Slice 30" reference names multi-machine/A2A

$ grep -n "Slice 29" docs/ROADMAP.md
312: 20. Voice in/out + streaming CLI (Phase F, Slice 29).
# only the voice/streaming row — no stale "Slice 29" TUI references left
```

## Commands run + output

```
$ bun run test:file -- "tests/media/gen-select.test.ts" "tests/media/gen-tools-wiring.test.ts" "tests/media/generate-tools.test.ts"
bun test v1.3.11 (af24e281)
 15 pass
 0 fail
 24 expect() calls
Ran 15 tests across 3 files. [90.00ms]

$ bun run lint:file --write -- "src/media/generate/select.ts" "src/media/generate/tools.ts" "tests/media/gen-select.test.ts" "tests/media/gen-tools-wiring.test.ts"
Checked 4 files in 6ms. Fixed 1 file.   # biome reformatted the new multi-line object literals in gen-select.test.ts

$ bun run lint:file -- "src/media/generate/select.ts" "src/media/generate/tools.ts" "tests/media/gen-select.test.ts" "tests/media/gen-tools-wiring.test.ts"   # re-check after --write
Checked 4 files in 4ms. No fixes applied.   # clean

$ bun run typecheck
$ tsc --noEmit
(no output — clean)

$ bun run docs:check
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```

Note: a full-repo `bun run lint` was NOT run as part of this task's gate list
(the task specified `lint:file` on the four touched files only). A quick
check showed 2 pre-existing, unrelated formatting errors in
`tests/media/gen-catalog.test.ts` (a file this fix wave never touched) —
out of scope for this task and left untouched.

## Commit

Staged only the fix-wave's own files (left the working tree's other
in-progress SDD ledger/`.remember` changes alone, since they belong to a
different task):
`src/media/generate/select.ts`, `src/media/generate/tools.ts`,
`tests/media/gen-select.test.ts`, `tests/media/gen-tools-wiring.test.ts`,
`docs/ROADMAP.md`.

Commit message:
`fix(slice-28): rank by footprint, graceful tool failures, finish ROADMAP renumber`
