# Task 15 Report: Wire `MicButton` into `composer.tsx` (Slice 30b Phase 7)

## Status: DONE

## Commit
- `eabd2c3` — `feat(voice): wire MicButton into the Composer (D2 — value-only, submit path untouched)`

## What changed
- `web/src/features/chat/composer.tsx`:
  - Added `import { MicButton } from '../voice/mic-button.tsx';`
  - Added `handleVoiceFinal(text)` next to `handleSubmit`: `setValue((v) => (v ? \`${v} ${text}\` : text))`
  - Inserted `<div className="flex items-center gap-2 px-3 pt-2"><MicButton onFinal={handleVoiceFinal} /></div>` inside the `composer-dropzone` `<section>`, after the attachments block and before `<PromptInput>`.
  - No other line changed. Confirmed via `git diff` before commit: only the import, the new handler, and the new `<div>` wrapper were added. `handleSubmit`, `onSend`, and all transport/submit code are byte-identical to before.
- `web/src/features/chat/composer.test.tsx` (new): 3 tests per the brief, using a `vi.mock('../voice/mic-button.tsx', ...)` fixture that renders a `fixture-mic` button calling `onFinal('voice transcript')`.

## TDD sequence
1. Wrote the test file first, ran `cd web && bun run test -- composer.test.tsx` → RED (2/3 failed: `fixture-mic` not found, since `MicButton` wasn't mounted yet).
2. Implemented the three edits above.
3. Re-ran → GREEN (3/3 passed).

## Test results
- `cd web && bun run test -- composer.test.tsx` → 3/3 passed.
- `cd web && bun run test` (full web suite) → 56 files / 282 tests passed (some expected `ECONNREFUSED` stderr noise from an unrelated pre-existing connection-refused-handling test, not a failure). `chat/index.test.tsx` (unmodified) continues to render the real `MicButton`, which renders `null` since voice is disabled by default in Settings — no regression.
- `cd web && bun run typecheck` → clean.
- `bun run lint:file -- web/src/features/chat/composer.tsx web/src/features/chat/composer.test.tsx` (root biome) → "Checked 2 files. No fixes applied."

## Transport/submit path confirmation
Verified by diff inspection and by test 3 ("leaves the existing Send/onSend submit path completely untouched"): `handleSubmit`, `onSend`, and `sendMessage` are untouched — voice only calls `setValue` via `handleVoiceFinal`; the user still presses Send to submit. `onSend` is asserted called with `('typed message', [])` and the textarea clears afterward, exactly as before this change.

## Grouping region (optional, Task 14 reviewer note)
Skipped. The brief's own reference edit doesn't include it, and adding a labelled `role="group"` wrapper around the mic buttons + attachment affordances would require restructuring beyond the minimal, byte-identical-elsewhere diff required for this final Increment-5 task. Not attempted to avoid scope creep.

## Concerns
None.

## Gate commands run
```
cd web && bun run test -- composer.test.tsx
cd web && bun run test
cd web && bun run typecheck
bun run lint:file -- web/src/features/chat/composer.tsx web/src/features/chat/composer.test.tsx
```
All green. Root `bun run check` deferred to the controller per task instructions (Increment 5 boundary gate).
