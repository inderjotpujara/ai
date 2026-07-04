### Task 10: hf-fetch — retry + stall-watchdog parity

**Files:** Modify: `src/provisioning/providers/hf-fetch.ts` (wrap the fetch/loop in `withRetry` + `StallWatchdog` from `supervisor.ts`, mirroring `ollama.ts:26-27,72-88`); Test: `tests/provisioning/hf-fetch.test.ts`.

- [ ] **Step 1: Write the failing test** — a `fetchImpl` that throws on first call, succeeds on second; assert the file still downloads (retry engaged).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Wrap** the per-file download in `withRetry(fn, { attempts: 4, baseMs, capMs, jitter: true, signal })` and beat a `StallWatchdog(90_000, onStall)` on each chunk. On retry, the `.part` `finally`-cleanup from Task 6 guarantees a clean restart.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "feat(provisioning): hf-fetch retry + stall-watchdog parity with Ollama"
```

**WS2 checkpoint:** `bun run typecheck && bun test` green; `hf-fetch` persists GGUF + MLX snapshots atomically.

---

## WS3 — MLX runtime to Ollama's bar

