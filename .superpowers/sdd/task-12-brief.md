### Task 12: Documentation (4-surface hard line)

**Files:**
- Modify: `docs/architecture.md` (new §Voice + subsystem-registry table row for `src/voice`)
- Modify: `README.md` (status line + slice-status table row + a feature paragraph)
- Modify: `docs/ROADMAP.md` (flip "Voice INPUT (STT)" → ✅ shipped Slice 29 in gap table + phase table + recommended sequence)
- Modify: `.superpowers/sdd/progress.md` (Slice 29 ledger section: per-task commits, decisions, live-verify)

**Interfaces:** none (docs).

- [ ] **Step 1: Write the §Voice architecture section**

Add a `## Voice input (STT) (Slice 29)` section modeled on §22 Multimodal: file table (`src/voice/{types,model,transcribe,capture,ingest,cli-io}.ts` + `stt-worker.mjs` + `scripts/setup-voice.ts`), the capture→transcribe data-flow, the execution seam (in-process vs node-subprocess, chosen by spike), ffmpeg-silencedetect auto-stop, env-var block (`AGENT_VOICE_DIR`, `AGENT_VOICE_STT_MODEL`, `AGENT_FFMPEG_CMD`, `AGENT_VOICE_EXEC`), telemetry (`voice.transcribe` + `VOICE_*`), and the live-verify status. Add `src/voice` to the subsystem-registry table.

- [ ] **Step 2: Run docs-check**

Run: `bun run docs:check`
Expected: PASS — `src/voice` now documented (it FAILS before this step).

- [ ] **Step 3: Update README + ROADMAP + ledger**

README: status line, add a slice-29 ✅ row to the slice-status table, add a "Voice input" feature paragraph + update the "Next" line to Slice 30. ROADMAP: flip the "Voice INPUT (STT)" gap row + recommended-sequence item 20 to ✅ Slice 29. Ledger: append the Slice-29 section (per-task commit SHAs, decisions D1–D8 + the silencedetect refinement, live-verify results).

- [ ] **Step 4: Verify docs gate**

Run: `bun run docs:check && bun run typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(slice-29): §Voice architecture + README/ROADMAP/ledger"
```

---

