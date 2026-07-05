### Task 10: Migrate provisioning onto reliability/{retry,timeout}

**Files:**
- Modify: `src/provisioning/supervisor.ts` (re-export from reliability; keep `checkDiskSpace`)
- Modify: `src/provisioning/providers/ollama.ts` (use shared `defaultDownloadRetry()` + `IdleWatchdog`)
- Modify: `src/provisioning/providers/hf-fetch.ts` (same)
- Create: `src/reliability/download-retry.ts` (shared download retry config)
- Test: `tests/reliability/download-retry.test.ts`; existing `tests/provisioning/supervisor.test.ts` must still pass.

**Interfaces:**
- Consumes: `withRetry`, `abortableSleep` (retry.ts); `IdleWatchdog` (timeout.ts).
- Produces: `defaultDownloadRetry(): { attempts: number; baseMs: number; capMs: number; jitter: () => number }`; `downloadStallMs(): number`.
- `supervisor.ts` re-exports `withRetry`, `abortableSleep`, and a back-compat `StallWatchdog` alias = `IdleWatchdog` so existing imports keep working.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/download-retry.test.ts
import { describe, expect, it } from 'bun:test';
import { defaultDownloadRetry, downloadStallMs } from '../../src/reliability/download-retry.ts';

describe('download retry defaults', () => {
  it('provides positive backoff parameters', () => {
    const r = defaultDownloadRetry();
    expect(r.attempts).toBeGreaterThan(0);
    expect(r.capMs).toBeGreaterThanOrEqual(r.baseMs);
    expect(typeof r.jitter()).toBe('number');
    expect(downloadStallMs()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/download-retry.test.ts`
Expected: FAIL — cannot resolve `download-retry.ts`.

- [ ] **Step 3: Write the shared config + migrate**

```ts
// src/reliability/download-retry.ts
import { retryBaseMs, retryCapMs } from './config.ts';

/** Shared download retry shape (was duplicated in ollama.ts + hf-fetch.ts). */
export function defaultDownloadRetry(): {
  attempts: number;
  baseMs: number;
  capMs: number;
  jitter: () => number;
} {
  return {
    attempts: Number(process.env.AGENT_DOWNLOAD_ATTEMPTS) || 6,
    baseMs: retryBaseMs(),
    capMs: retryCapMs(),
    jitter: () => 0.5 + Math.random() / 2,
  };
}

/** Idle/stall timeout for a download with no byte progress. */
export function downloadStallMs(): number {
  return Number(process.env.AGENT_DOWNLOAD_STALL_MS) || 90_000;
}
```

In `src/provisioning/supervisor.ts`: delete the local `abortableSleep`, `withRetry`, and `StallWatchdog` bodies; replace with re-exports (keep `checkDiskSpace` + `PreflightInput` in place):

```ts
export { abortableSleep, withRetry } from '../reliability/retry.ts';
export { IdleWatchdog as StallWatchdog } from '../reliability/timeout.ts';
```

In `src/provisioning/providers/ollama.ts`: replace the inline `withRetry(..., { attempts: 6, baseMs: 1_000, capMs: 45_000, jitter: ... })` config with `defaultDownloadRetry()` (spread), and the `STALL_MS`/`new StallWatchdog(STALL_MS, ...)` with `downloadStallMs()`/`new IdleWatchdog(downloadStallMs(), ...)`; `beat(bytes)` replaces `beat(bytes)` (signature identical — `progress` is the byte count). Import from `../../reliability/download-retry.ts` and `../../reliability/timeout.ts`.

In `src/provisioning/providers/hf-fetch.ts`: replace the local `DEFAULT_RETRY` constant with `deps.retry ?? defaultDownloadRetry()` (keep the `RetryConfig`-shaped `deps.retry` injection seam by widening its type to the returned shape) and `STALL_MS` with `downloadStallMs()`, `StallWatchdog` with `IdleWatchdog`.

- [ ] **Step 4: Run tests to verify no regression**

Run: `bun test tests/reliability/download-retry.test.ts tests/provisioning/`
Expected: PASS — the new test plus all existing provisioning tests (supervisor, ollama, hf-fetch) still green.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/download-retry.ts" "src/provisioning/supervisor.ts" "src/provisioning/providers/ollama.ts" "src/provisioning/providers/hf-fetch.ts"
git add src/reliability/download-retry.ts src/provisioning/
git commit -m "refactor(provisioning): migrate retry/stall onto reliability module"
```

---

