# Task 8 report — gated live-verify for Slice 28 gen-fit

## Status: DONE

Commit: `fed57fa` — "test(media): gated live-verify for gen-fit (image/speech render, video degrade)"
(branch: `slice-28-hardware-adaptive-gen`)

## What was added

Extended the existing `tests/integration/multimodal.live.test.ts` (Slice 27's
gated-live-verify file) with 4 new cases, matching its existing gating style
(`MULTIMODAL_LIVE=1` → `describe` vs `describe.skip`):

1. **(gated live, inside the existing `suite(...)` block) `gen-fit: image
   auto-fit selects the installed anchor and renders`** — asserts
   `selectGenModel(MediaKind.Image)` resolves to
   `dhairyashil/FLUX.1-schnell-mflux-4bit`, then drives
   `createGenerateTools(store).generate_image.execute({prompt: ...})` against a
   real run-scoped `MediaStore`, extracts the `file://` URI from the returned
   string via `fileURLToPath`, and asserts the file exists and is non-empty.

2. **(gated live)** `gen-fit: speech auto-fit selects Kokoro and renders` —
   same shape for `generate_speech`, asserting `selectGenModel(MediaKind.Audio)`
   → `mlx-community/Kokoro-82M-bf16` and a non-empty `.wav` file on disk.

3. **(NOT gated — deterministic, new `describe(...)` block)** `video tool
   degrades gracefully when no model fits` — calls
   `createGenerateTools(store, { selectModel: async () => undefined
   }).generate_video.execute({prompt:'x'})` and asserts the returned message
   contains both "no video" and "not generated" (case-insensitive), proving
   the no-fit path never crashes. No real video render is attempted (correct,
   since no video model is installed on this box).

4. **(NOT gated — deterministic)** `selectGenModel returns undefined under a
   forced-tiny budget` — `selectGenModel(MediaKind.Video, { budgetBytes: 1,
   isInstalled: () => true })` resolves to `undefined`.

Also added a small `uriToPath` helper (`fileURLToPath` from `node:url`) to
turn the tool's `file://...` return string into a filesystem path for
`existsSync`/`statSync` assertions, and imported `createGenerateTools` /
`selectGenModel` from `src/media/generate/tools.ts` / `select.ts`.

Note on tool `.execute` calls: `createGenerateTools` returns `ToolSet`
(`Record<string, Tool>`), and with `noUncheckedIndexedAccess` enabled in this
repo's `tsconfig.json`, indexing into it types as `Tool | undefined` — so the
calls use `?.` (`generate_image?.execute?.(...)`) purely to satisfy the
compiler; the tools are always defined in this construction (no behavior
change).

## Verification performed

- `bun run test:file -- "tests/integration/multimodal.live.test.ts"` (no
  `MULTIMODAL_LIVE` set): **2 pass, 9 skip, 0 fail** — the 2 passing are the
  new deterministic video-degrade + forced-tiny-budget cases; the 9 skipped
  are all live-gated cases (7 pre-existing Slice-27 + 2 new gen-fit ones),
  correctly skipped without the env var.
- `bun run lint:file --write -- "tests/integration/multimodal.live.test.ts"`
  then a clean re-run of `bun run lint:file` (no `--write`): **no
  findings** (the `--write` pass only reordered imports).
- `bun run typecheck`: **clean, no errors.**

The gated live cases (image/speech auto-fit render) were NOT executed by me —
per the brief, the controller runs `MULTIMODAL_LIVE=1 bun run test:file --
"tests/integration/multimodal.live.test.ts"` afterward on this box (where the
image/Kokoro HF caches are confirmed present) to actually exercise the real
renders.

## Blocking concerns

None. No bugs surfaced in the non-gated run. The gated image/speech render
cases still need a live run with `MULTIMODAL_LIVE=1` (and ideally
`AGENT_IMAGE_CMD=/tmp/mlxvenv/bin/mflux-generate
AGENT_TTS_CMD=/tmp/mlxvenv/bin/mlx_audio.tts.generate` set per the brief's env
facts) to confirm the real mflux/Kokoro renders succeed end-to-end — that is
the controller's live-verify step per the task contract, not something I could
self-certify from this dispatch.
