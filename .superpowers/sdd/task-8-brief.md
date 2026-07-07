### Task 8: Live-verify (real models on this box)

**Files:**
- Modify: `tests/integration/multimodal.live.test.ts` (add gen-fit cases, gated `MULTIMODAL_LIVE=1`)

**Interfaces:**
- Consumes: the full wired path (Tasks 1–7); `bun run setup:media` venvs (`~/.cache/ai/media-venv`, `~/.cache/ai/media-video-venv`); Ollama for the `media_creator` chat model.

- [ ] **Step 1: Add gated live tests**

Add cases (skipped unless `MULTIMODAL_LIVE=1`):
- **Image auto-fit renders:** call `createGenerateTools(store).generate_image.execute({prompt:'a red cube on a table'})`; assert the returned URI file exists and is non-empty; assert `selectGenModel(Image)` chose `dhairyashil/FLUX.1-schnell-mflux-4bit` (installed anchor).
- **Speech auto-fit renders:** `generate_speech.execute({prompt:'hello world'})`; assert a non-empty `.wav`; chosen model = Kokoro.
- **Video auto-fit renders OR degrades:** `selectGenModel(Video)` returns the largest installed-and-fitting rung; if it returns a candidate, run `generate_video` and assert a non-empty `.mp4`; if `undefined`, assert the graceful no-fit message. Log which path ran.
- **Forced-tiny-budget degrade (deterministic, NOT gated):** `selectGenModel(MediaKind.Video, { budgetBytes: 1, isInstalled: () => true })` → `undefined` (already covered in Task 3, but assert the tool returns the "higher-memory/disk box" message here too).

- [ ] **Step 2: Run live-verify**

Run:
```bash
MULTIMODAL_LIVE=1 \
AGENT_IMAGE_CMD=$HOME/.cache/ai/media-venv/bin/mflux-generate \
AGENT_TTS_CMD=$HOME/.cache/ai/media-venv/bin/mlx_audio.tts.generate \
AGENT_VIDEO_CMD=$HOME/.cache/ai/media-video-venv/bin/mlx_video.ltx_2.generate \
bun run test:file -- "tests/integration/multimodal.live.test.ts"
```
Expected: image + speech render; video renders or degrades with a clear message. **Fix any real bugs live-verify surfaces** (e.g. the exact `--model` flag name for mlx-video, the LTX-2.3-mlx-q4 repo download path) and re-run — this is where integration bugs the unit tests missed get caught.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/multimodal.live.test.ts
git commit -m "test(media): gated live-verify for gen-fit (image/speech render, video render-or-degrade)"
```

---

