### Task 9: Live-verify the download adapters (gated)

**Files:**
- Create: `tests/integration/altruntime-download.live.test.ts`

**Interfaces:** Consumes the existing `createLmStudioProvider` + `createHfFetchProvider`. Gate: `const LIVE = process.env.ALTRUNTIME_LIVE === '1'`.

- [ ] **Step 1: write the gated live test** — with `describe.skipIf(!LIVE)`: (a) a real LM Studio download of a tiny model via `createLmStudioProvider()` reaching `DownloadPhase.Done`; (b) a real llama.cpp GGUF fetch via the HfGguf provider to a temp dir, asserting the file exists + non-zero. These only run when the runtimes are installed (Task 17 installs them).
- [ ] **Step 2:** run WITHOUT the flag → SKIPPED (proves gating).
- [ ] **Step 3:** (no impl — adapters exist).
- [ ] **Step 4:** leave for Task 17's live pass.
- [ ] **Step 5: commit** (`test(runtime): gated live-verify for LM Studio + llama.cpp download adapters`).

---

# PHASE B — Remote MCP auth completion

