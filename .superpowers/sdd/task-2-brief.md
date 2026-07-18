### Task 2: Mirror `CaptureSource` into `src/contracts/enums.ts` with a parity test

**Files:**
- Modify: `src/contracts/enums.ts`
- Modify: `src/voice/types.ts:7-10` (the local `CaptureSource` definition, now removed → re-export)
- Test: `tests/contracts/capture-source-parity.test.ts`

**Interfaces:**
- Consumes: `src/contracts/enums.ts`'s existing enum-file conventions (mirrors `RuntimeKind`'s "wire mirror + parity test" pattern, `enums.ts:146-154`).
- Produces: `CaptureSource` enum (`Mic = 'mic'`, `File = 'file'` — values UNCHANGED from the CLI's current definition) importable from `src/contracts/enums.ts`, `src/contracts/index.ts`, and re-exported (not redefined) from `src/voice/types.ts` for `src/voice/transcribe.ts` and `src/telemetry/spans.ts`'s existing import sites.

**⚠ Values preserved (no rename):** the CLI's `CaptureSource` uses lowercase values (`Mic = 'mic'`, `File = 'file'`). This lift is a source-RELOCATION only — the enum values stay byte-identical, so the `voice.transcribe` span's `voice.capture.source` attribute value does NOT change and no existing test needs updating. (The earlier `phase7-interfaces.md` note showing `'Mic'/'File'` was a controller error; preserve `'mic'/'file'`.) `src/voice/transcribe.ts`/`tests/voice/spans.test.ts`/`tests/voice/transcribe.test.ts` reference the enum members (`CaptureSource.Mic`), never the raw string, and `tests/voice/types.test.ts` already asserts `'mic'` — all keep passing unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/capture-source-parity.test.ts` (mirrors `tests/contracts/runtime-kind-parity.test.ts`):

```ts
import { expect, test } from 'bun:test';
import { CaptureSource as ContractCaptureSource } from '../../src/contracts/enums.ts';
import { CaptureSource as VoiceCaptureSource } from '../../src/voice/types.ts';

test('contract CaptureSource values stay isomorphic with voice (single-sourced post-lift, D5)', () => {
  expect(Object.values(ContractCaptureSource).sort()).toEqual(
    Object.values(VoiceCaptureSource).sort(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/capture-source-parity.test.ts`
Expected: FAIL — `src/contracts/enums.ts` has no export named `CaptureSource`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/contracts/enums.ts` (after the `McpAuthKind` block, before `McpServerStatus`, or simply at the end of the file — appending at the end is simplest and matches the file's existing "append new enums as features land" pattern):

```ts
/** Wire mirror of `src/voice/types.ts` CaptureSource (isomorphic rule — no
 *  `src/voice/` import; that module is Node-only, pulling Bun spawn/ffmpeg
 *  glue). Lifted to be the SINGLE source of truth (Slice 30b Phase 7, D5) —
 *  `src/voice/types.ts` re-exports this rather than redefining it, so this
 *  parity test is a regression guard against future redefinition drift, not
 *  a live divergence check. Needed as a `voice.transcribe` span attribute
 *  value (`src/telemetry/spans.ts` `VOICE_CAPTURE_SOURCE`) from the browser
 *  path. `tests/contracts/capture-source-parity.test.ts` guards value
 *  parity. */
export enum CaptureSource {
  Mic = 'mic',
  File = 'file',
}
```

Modify `src/voice/types.ts` — replace the local `CaptureSource` enum (lines 7-10) with a re-export, right below the `VoiceFrames` re-export from Task 1:

```ts
/** Re-exported from contracts (Slice 30b Phase 7, D5) — see the VoiceFrames
 *  re-export above for the rationale. */
export { CaptureSource } from '../contracts/enums.ts';
```

No test change is needed — `tests/voice/types.test.ts` already asserts `CaptureSource.Mic` is `'mic'`, which stays true (values preserved).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/capture-source-parity.test.ts tests/voice/`
Expected: PASS (parity test + all pre-existing voice tests, unchanged).

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/enums.ts src/voice/types.ts tests/contracts/capture-source-parity.test.ts
git commit -m "feat(voice): mirror CaptureSource into contracts with a parity test (D5)"
```

