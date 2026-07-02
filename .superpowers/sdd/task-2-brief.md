### Task 2: Ollama download adapter (NDJSON stream) + supervisor guards

**Files:**
- Create: `src/provisioning/ollama-pull.ts` (NDJSON stream parse → normalized events)
- Create: `src/provisioning/supervisor.ts` (disk-preflight, stall-watchdog, retry/backoff)
- Create: `src/provisioning/providers/ollama.ts` (the `DownloadProvider`)
- Test: `tests/provisioning/ollama-pull.test.ts`
- Test: `tests/provisioning/supervisor.test.ts`

**Interfaces:**
- Consumes: `DownloadProgress`, `DownloadPhase`, `DownloadProvider`, `ProgressTracker` (Task 1); `ProviderKind` (core); `isModelInstalled` (ollama-control).
- Produces:
  - `parseOllamaLine(line: string): { phase: DownloadPhase; digest?: string; completed?: number; total?: number } | null`
  - `aggregatePull(events, tracker): DownloadProgress` via a stateful `OllamaPullAggregator` class: `feed(line: string): DownloadProgress | null`.
  - `type PreflightInput = { requiredBytes: number; freeBytes: number; headroomBytes?: number }`; `checkDiskSpace(i: PreflightInput): { ok: boolean; shortfallBytes: number }`
  - `withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: { attempts: number; baseMs: number; capMs: number; jitter: () => number; onRetry?: (n: number) => void }): Promise<T>`
  - `class StallWatchdog` — `constructor(timeoutMs, now?, onStall: () => void)`; `beat(bytes: number): void`; `stop(): void` (drives an internal timer; abstracted for tests via injected `now` + manual `tick`).
  - `createOllamaProvider(opts?: { baseUrl?: string }): DownloadProvider`

- [ ] **Step 1: Write failing tests for NDJSON line parsing (detect by field presence, not verb).**

```ts
// tests/provisioning/ollama-pull.test.ts
import { describe, expect, it } from 'bun:test';
import { parseOllamaLine, OllamaPullAggregator } from '../../src/provisioning/ollama-pull.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';
import { ProgressTracker } from '../../src/provisioning/progress-tracker.ts';

describe('parseOllamaLine', () => {
  it('maps "pulling manifest" to Resolving', () => {
    expect(parseOllamaLine('{"status":"pulling manifest"}')?.phase).toBe(DownloadPhase.Resolving);
  });
  it('treats presence of digest+total+completed as Downloading regardless of verb', () => {
    const r = parseOllamaLine('{"status":"pulling 12ab","digest":"sha256:12ab","total":100,"completed":40}');
    expect(r?.phase).toBe(DownloadPhase.Downloading);
    expect(r?.completed).toBe(40);
    expect(r?.digest).toBe('sha256:12ab');
  });
  it('maps "verifying sha256 digest" to Verifying', () => {
    expect(parseOllamaLine('{"status":"verifying sha256 digest"}')?.phase).toBe(DownloadPhase.Verifying);
  });
  it('maps "success" to Done', () => {
    expect(parseOllamaLine('{"status":"success"}')?.phase).toBe(DownloadPhase.Done);
  });
  it('returns null for a blank line', () => {
    expect(parseOllamaLine('')).toBeNull();
  });
});

describe('OllamaPullAggregator', () => {
  it('aggregates per-layer completed/total by replacing (not summing) per digest', () => {
    const agg = new OllamaPullAggregator(new ProgressTracker('m', () => 0));
    agg.feed('{"status":"pulling manifest"}');
    agg.feed('{"digest":"a","total":100,"completed":50}');
    agg.feed('{"digest":"b","total":100,"completed":10}');
    const p = agg.feed('{"digest":"a","total":100,"completed":90}'); // replaces a=50 → 90
    expect(p?.bytesCompleted).toBe(100); // 90 + 10
    expect(p?.bytesTotal).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `bun test tests/provisioning/ollama-pull.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `src/provisioning/ollama-pull.ts`.**

```ts
import { type DownloadProgress, DownloadPhase } from './types.ts';
import type { ProgressTracker } from './progress-tracker.ts';

type OllamaEvent = { status?: string; digest?: string; total?: number; completed?: number };
type ParsedLine = { phase: DownloadPhase; digest?: string; completed?: number; total?: number };

/** Parse one NDJSON line. Detect a layer download by PRESENCE of digest+total+completed. */
export function parseOllamaLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let ev: OllamaEvent;
  try {
    ev = JSON.parse(trimmed) as OllamaEvent;
  } catch {
    return null;
  }
  if (ev.digest && typeof ev.total === 'number' && typeof ev.completed === 'number') {
    return { phase: DownloadPhase.Downloading, digest: ev.digest, completed: ev.completed, total: ev.total };
  }
  const s = ev.status ?? '';
  if (s === 'success') return { phase: DownloadPhase.Done };
  if (s.startsWith('verifying')) return { phase: DownloadPhase.Verifying };
  if (s.startsWith('writing') || s.startsWith('removing')) return { phase: DownloadPhase.Finalizing };
  return { phase: DownloadPhase.Resolving };
}

/** Stateful aggregator: per-digest replace, sum across digests, feed a ProgressTracker. */
export class OllamaPullAggregator {
  private layers = new Map<string, { completed: number; total: number }>();
  constructor(private readonly tracker: ProgressTracker) {}

  feed(line: string): DownloadProgress | null {
    const parsed = parseOllamaLine(line);
    if (!parsed) return null;
    if (parsed.phase === DownloadPhase.Downloading && parsed.digest) {
      this.layers.set(parsed.digest, { completed: parsed.completed ?? 0, total: parsed.total ?? 0 });
    }
    let completed = 0;
    let total = 0;
    for (const l of this.layers.values()) {
      completed += l.completed;
      total += l.total;
    }
    return this.tracker.update(parsed.phase, completed, total > 0 ? total : null);
  }
}
```

- [ ] **Step 4: Run, verify pass.**

Run: `bun test tests/provisioning/ollama-pull.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write failing tests for supervisor guards.**

```ts
// tests/provisioning/supervisor.test.ts
import { describe, expect, it } from 'bun:test';
import { checkDiskSpace, withRetry } from '../../src/provisioning/supervisor.ts';

describe('checkDiskSpace', () => {
  it('fails when required + headroom exceeds free', () => {
    const r = checkDiskSpace({ requiredBytes: 900, freeBytes: 1000, headroomBytes: 200 });
    expect(r.ok).toBe(false);
    expect(r.shortfallBytes).toBe(100); // 900+200 - 1000
  });
  it('passes with sufficient free space', () => {
    expect(checkDiskSpace({ requiredBytes: 500, freeBytes: 1000, headroomBytes: 200 }).ok).toBe(true);
  });
});

describe('withRetry', () => {
  it('retries a failing fn then succeeds, calling onRetry each time', async () => {
    let calls = 0;
    const retries: number[] = [];
    const out = await withRetry(
      async () => { calls++; if (calls < 3) throw new Error('boom'); return 'ok'; },
      { attempts: 5, baseMs: 0, capMs: 0, jitter: () => 0, onRetry: (n) => retries.push(n) },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });
  it('rethrows after exhausting attempts', async () => {
    await expect(
      withRetry(async () => { throw new Error('always'); }, { attempts: 2, baseMs: 0, capMs: 0, jitter: () => 0 }),
    ).rejects.toThrow('always');
  });
});
```

- [ ] **Step 6: Run, verify fail; then create `src/provisioning/supervisor.ts`.**

```ts
export type PreflightInput = { requiredBytes: number; freeBytes: number; headroomBytes?: number };

const DEFAULT_HEADROOM = 2 * 1024 ** 3; // 2 GB slack over the sum of downloads

/** Disk-space preflight: Ollama does not do this and fails mid-download. */
export function checkDiskSpace(i: PreflightInput): { ok: boolean; shortfallBytes: number } {
  const need = i.requiredBytes + (i.headroomBytes ?? DEFAULT_HEADROOM);
  const shortfall = need - i.freeBytes;
  return { ok: shortfall <= 0, shortfallBytes: Math.max(0, shortfall) };
}

/** Full-jitter exponential backoff retry. Idempotent re-invocation is the retry primitive. */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: { attempts: number; baseMs: number; capMs: number; jitter: () => number; onRetry?: (n: number) => void },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const ctrl = new AbortController();
    try {
      return await fn(ctrl.signal);
    } catch (err) {
      lastErr = err;
      const next = attempt + 1;
      if (next >= opts.attempts) break;
      opts.onRetry?.(next);
      const backoff = Math.min(opts.capMs, opts.baseMs * 2 ** attempt);
      const delay = Math.floor(opts.jitter() * backoff);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Aborts a download whose byte count hasn't advanced within `timeoutMs`. */
export class StallWatchdog {
  private lastBytes = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stalledSince: number | null = null;
  constructor(
    private readonly timeoutMs: number,
    private readonly onStall: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {}
  beat(bytes: number): void {
    if (bytes > this.lastBytes) {
      this.lastBytes = bytes;
      this.stalledSince = null;
    } else if (this.stalledSince === null) {
      this.stalledSince = this.now();
    }
  }
  /** Call on a timer (or manually in tests); fires onStall past the timeout. */
  tick(): void {
    if (this.stalledSince !== null && this.now() - this.stalledSince >= this.timeoutMs) {
      this.onStall();
    }
  }
  start(intervalMs: number): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 7: Run, verify pass.**

Run: `bun test tests/provisioning/supervisor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Create `src/provisioning/providers/ollama.ts` (the DownloadProvider; streams `/api/pull`, supervised).**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import { isModelInstalled } from '../../resource/ollama-control.ts';
import { OllamaPullAggregator } from '../ollama-pull.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { StallWatchdog, withRetry } from '../supervisor.ts';
import { type DownloadProgress, DownloadPhase, type DownloadProvider } from '../types.ts';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const STALL_MS = 90_000; // longer than Ollama's own 30s per-part watchdog

/** Stream one /api/pull attempt, feeding normalized progress until success or error. */
async function streamPull(
  baseUrl: string,
  model: string,
  onProgress: (p: DownloadProgress) => void,
  outer: AbortSignal,
): Promise<void> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outer.addEventListener('abort', onAbort);
  const watchdog = new StallWatchdog(STALL_MS, () => ctrl.abort());
  watchdog.start(5_000);
  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new ProviderError(`Ollama /api/pull returned ${res.status}`);
    const agg = new OllamaPullAggregator(new ProgressTracker(model));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const p = agg.feed(line);
        if (p) {
          watchdog.beat(p.bytesCompleted);
          onProgress(p);
          if (p.phase === DownloadPhase.Done) return;
        }
      }
    }
  } finally {
    watchdog.stop();
    outer.removeEventListener('abort', onAbort);
  }
}

export function createOllamaProvider(opts: { baseUrl?: string } = {}): DownloadProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  return {
    kind: ProviderKind.Ollama,
    async download(modelRef, { onProgress, signal }) {
      await withRetry(() => streamPull(baseUrl, modelRef, onProgress, signal), {
        attempts: 6,
        baseMs: 1_000,
        capMs: 45_000,
        jitter: () => 0.5 + Math.random() / 2, // full-ish jitter, kind to the registry
        onRetry: (n) => onProgress({
          modelRef, phase: DownloadPhase.Resolving, bytesCompleted: 0, bytesTotal: null,
          percent: null, speedBytesPerSec: null, error: `retry ${n}`,
        }),
      });
      // Confirm the install actually landed before declaring done.
      if (!(await isModelInstalled(modelRef, baseUrl))) {
        throw new ProviderError(`Ollama reported success but ${modelRef} is not installed`);
      }
    },
  };
}
```

Note: `Math.random()` is fine in `src/` runtime code (the `Math.random` restriction applies only to Workflow scripts). Digest-mismatch recovery (rm + delete partial blob + re-pull) is exercised in the live-verify step (Step 10); the retry loop + install-confirm covers the automated path.

- [ ] **Step 9: Typecheck, lint, run all provisioning unit tests.**

Run: `bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts" && bun test tests/provisioning/`
Expected: clean + all PASS.

- [ ] **Step 10: LIVE-VERIFY (Ollama) — this is the merge gate for the adapter.**

Run (with `ollama serve` up):
```bash
bun run - <<'TS'
import { createOllamaProvider } from './src/provisioning/providers/ollama.ts';
import { ProgressBar } from './src/provisioning/ui/progress-bar.ts';
const p = createOllamaProvider();
const bar = new ProgressBar(process.stderr, process.stderr.isTTY ?? false);
const ctrl = new AbortController();
await p.download('qwen3-embedding:0.6b', { onProgress: (x) => bar.render(x), signal: ctrl.signal });
bar.done(p as any); console.error('\nDONE');
TS
```
Expected: a live-updating bar reaching 100%, `[done]`, then `DONE`. Verify `ollama list` shows the model. Then delete it (`ollama rm qwen3-embedding:0.6b`) and re-run to confirm re-provisioning works. Record the result in the SDD ledger.

- [ ] **Step 11: Commit.**

```bash
git add src/provisioning/ollama-pull.ts src/provisioning/supervisor.ts src/provisioning/providers/ollama.ts tests/provisioning/ollama-pull.test.ts tests/provisioning/supervisor.test.ts
git commit -m "feat(provisioning): Ollama download adapter + supervisor guards, live-verified (Slice 14 Task 2)"
```

---

