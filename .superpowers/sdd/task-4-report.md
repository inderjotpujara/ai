# Task 4 Report — Settings UI: voice-enable toggle + model-tier selector (Phase 7)

## Status: DONE

Note: this report file previously held a stale Phase-6 Task 4 report (session
migrations). That content is unrelated to this Phase-7 Task 4 and has been
replaced below; the earlier work it described was already committed under its
own SHA in an earlier phase and is unaffected by this overwrite.

## What was done
Followed the brief's TDD steps exactly; the pre-existing
`web/src/features/settings/index.tsx` and `index.test.tsx` matched the
brief's documented "before" state 1:1, so no reconciliation was needed.

1. **RED**: Appended the `describe('SettingsArea — voice input', ...)` block
   (4 tests) to `web/src/features/settings/index.test.tsx` and added
   `isVoiceInputEnabled, voiceModelTier` to the import. Ran
   `bun run test -- settings/index.test.tsx` → confirmed the 4 new tests
   failed (missing exports / missing `data-testid`), while the 4 pre-existing
   tests still passed.
2. **GREEN**: Replaced `web/src/features/settings/index.tsx` with the brief's
   verbatim implementation: `ModelTier = 'moonshine-base' | 'moonshine-tiny'`
   (temporary home, per the Task 8 plan), `isVoiceInputEnabled()` /
   `voiceModelTier()` accessors mirroring `isOsNotifyEnabled()`, a second
   `<section>` control block (voice-input toggle
   `data-testid="voice-input-toggle"` + model-tier
   `<select data-testid="voice-model-tier">`), localStorage keys
   `agent.voiceInputEnabled` / `agent.voiceModelTier`, default-tier read from
   `window.__AGENT_VOICE_DEFAULT_MODEL__` falling back to `'moonshine-base'`.
3. Ran Biome's formatter (`bunx biome check --write`) on the two touched
   files to fix line-wrap-only formatting diffs surfaced by `lint:file`
   (multi-line ternary, JSX text wrap) — no logic changes, just formatting
   per project style.
4. Committed both files with the exact conventional-commit subject from the
   brief (`feat(voice): Settings voice-enable toggle + model-tier selector
   (D7)`), body expanded with a short rationale.

## Files touched
- `web/src/features/settings/index.tsx` (modified — full replacement per brief)
- `web/src/features/settings/index.test.tsx` (modified — new describe block appended)

## Gate results (all inline, all green)
- `cd web && bun run test -- settings/index.test.tsx` → RED first (4 failed /
  4 passed), then GREEN (8 passed / 8).
- `cd web && bun run typecheck` (`tsc --noEmit`) → clean, no errors.
- `cd web && bun run test` (full suite) → **48 files, 208 tests, all passed.**
- `bun run lint:file -- web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx`
  → 2 Biome formatting errors on first pass (line-wrap style), fixed via
  `biome check --write`, re-ran clean (0 errors).
- Root `bun run docs:check` ran automatically as the pre-commit hook (no
  `src/**` files touched, only `web/src/features/**` — hook passed with no
  living-doc changes required).

## Commit
- `06db17b` — `feat(voice): Settings voice-enable toggle + model-tier selector (D7)`
  (2 files changed, 142 insertions, 2 deletions)

## Self-review
- Structure mirrors the OS-notify toggle exactly: same `<Button
  data-testid>` pattern, same localStorage read/write via `useEffect` +
  try/catch degrade, same accessor shape (`isVoiceInputEnabled` next to
  `isOsNotifyEnabled`).
- No browser permission gating on the voice toggle (plain localStorage flip),
  per the brief — mic permission is deferred to Task 12's capture start, not
  toggle time.
- `defaultModelTier()` correctly falls back to `'moonshine-base'` when
  `window.__AGENT_VOICE_DEFAULT_MODEL__` is unset (as in tests), and the
  model-tier `<select>` is `disabled` while voice input is off, matching the
  UX intent (tier only matters once enabled).
- No console.log, no deviation from the brief's code beyond Biome's
  formatting-only reflow.

## Notes / concerns
- No divergence between the brief and the real file state — implementation
  is verbatim per brief, no judgment calls needed.
- Per the brief, `ModelTier` lives in `settings/index.tsx` temporarily; Task 8
  is expected to move it to `web/src/features/voice/stt-engine.ts` and switch
  this file to import it instead — flagged here for whoever picks up Task 8
  so the duplicate definition doesn't linger past that task.
- No docs/architecture.md change made or needed (web-only UI addition to an
  existing documented subsystem, no new subsystem).
- Root `bun run typecheck`/`lint` were not run since the brief and diff are
  confined to `web/`; only web-scoped gates applied, consistent with the task
  instructions.
