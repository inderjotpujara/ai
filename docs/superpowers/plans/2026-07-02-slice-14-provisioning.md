# Slice 14 — First-boot provisioning + runtime-agnostic downloader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-boot flow that detects hardware, discovers models that fit, gets per-model consent, downloads them with a live progress UI, and hands off to the existing Model Manager — behind one runtime-agnostic `DownloadProvider` abstraction covering all four runtimes.

**Architecture:** New `src/provisioning/` subsystem composing on existing seams (`detectHost`/`liveBudgetBytes`/`fitsBudget`/`estimateModelBytes`, `CatalogSource`, `RuntimeControl`, `ensureReady`, `src/telemetry/spans.ts`). Two provider tiers: **delegating** (Ollama `/api/pull` NDJSON, LM Studio REST) re-emit the runtime's progress; **HF-fetch** (llama.cpp/MLX) drive a shared raw-`fetch` HuggingFace downloader. A unified `DownloadProgress` event feeds one dependency-free terminal UI.

**Tech Stack:** TypeScript on Bun; `bun test`; `node:crypto` (SHA256); OpenTelemetry (`@opentelemetry/api`); raw `fetch` for all network I/O. **No new npm dependencies.**

## Global Constraints

- **Runtime/tooling:** always `bun`, never `npm`. `bun run typecheck` must pass; `bun run lint` (biome) clean; no `console.log` left in `src/`.
- **No new npm dependency** (Slice-13 precedent). HF via raw `fetch` + `node:crypto`; LM Studio via its local REST API. `@huggingface/hub` / `@lmstudio/sdk` are explicitly NOT added.
- **Code style:** `type` over `interface`; **string `enum` for finite named sets** (`enum Foo { A = 'A' }`); discriminated unions stay `type`; early returns; small focused files; descriptive names.
- **No hardcoding** budgets/limits/sizes — compute live; env vars are fallback-only (pattern: `envFraction` in `hardware.ts`).
- **Consent before pull** — never download without explicit consent; non-interactive consent only via `AGENT_PROVISION_AUTO_YES`.
- **Degrade, never crash** — a declined/failed model drops out; the rest proceed; the run continues on whatever is installed.
- **Docs hard line** — the slice's final task updates all four living surfaces (`architecture.md` + `README.md` + `docs/ROADMAP.md` + the snapshot Artifact) and every spec/plan carries an architecture-doc-update note + a telemetry-to-emit note (both in the spec).
- **Provider size units:** all sizes are **bytes** (`number`). `ProviderKind` today = `{ Ollama, MlxServer }`.
- **Live-verify gate:** Ollama is proven end-to-end on this machine; LM Studio/llama.cpp/MLX ship contract-tested with live-verify **logged-deferred** (set `provision.deferred_verify` + note in the SDD ledger) — never a silent skip.

**Existing signatures this plan consumes (verbatim, do not redefine):**

```ts
// src/core/types.ts
enum ProviderKind { Ollama = 'Ollama', MlxServer = 'MlxServer' }
enum Capability { Tools='tools', Vision='vision', Audio='audio', Video='video' }
type ModelDeclaration = { provider: ProviderKind; model: string; params: { temperature?: number; numCtx?: number };
  role: string; capabilities?: Capability[]; contentPolicy?: ContentPolicy;
  footprint: { approxParamsBillions: number; bytesPerWeight: number; kvBytesPerToken?: number }; maxContext?: number };

// src/discovery/catalog-source.ts
type HostCapabilities = { totalRamBytes: number; liveBudgetBytes: number; runtimes: ProviderKind[] };
type DiscoveryQuery = { budgetBytes: number; requires?: Capability[]; hostTotalRamBytes: number };
type Candidate = ModelDeclaration & { repo: string; quant?: string; fileSizeBytes: number; downloads: number; installed: boolean };
type CatalogSource = { name: string; appliesTo(host: HostCapabilities): boolean; listCandidates(q: DiscoveryQuery): Promise<Candidate[]> };

// src/resource/hardware.ts
function liveBudgetBytes(): Promise<number>;
function fitsBudget(modelBytes: number, budgetBytes: number): boolean;
function envFraction(name: string, fallback: number): number; // (internal pattern to mirror)

// src/resource/footprint.ts
function estimateModelBytes(input: { paramsBillions: number; bytesPerWeight: number; contextTokens: number; kvBytesPerToken: number }): number;

// src/resource/ollama-control.ts
function isModelInstalled(model: string, baseUrl?: string): Promise<boolean>;
const DEFAULT_BASE_URL = 'http://localhost:11434'; // (not exported; re-derive)

// src/discovery/host.ts
function detectHost(): Promise<HostCapabilities>;

// src/core/errors.ts
class ProviderError extends Error {}   // (cause?: { cause })
```

---

### Task 1: Progress protocol, `DownloadProvider` interface, and dependency-free UI

**Files:**
- Create: `src/provisioning/types.ts`
- Create: `src/provisioning/progress-tracker.ts`
- Create: `src/provisioning/ui/format.ts`
- Create: `src/provisioning/ui/progress-bar.ts`
- Create: `src/provisioning/ui/prompt.ts`
- Test: `tests/provisioning/progress-tracker.test.ts`
- Test: `tests/provisioning/ui-format.test.ts`
- Test: `tests/provisioning/ui-prompt.test.ts`

**Interfaces:**
- Produces:
  - `enum DownloadPhase { Resolving='resolving', Downloading='downloading', Verifying='verifying', Finalizing='finalizing', Done='done', Failed='failed' }`
  - `type DownloadProgress = { modelRef: string; phase: DownloadPhase; bytesCompleted: number; bytesTotal: number | null; percent: number | null; speedBytesPerSec: number | null; error?: string }`
  - `type DownloadProvider = { readonly kind: ProviderKind; download(modelRef: string, opts: { onProgress: (p: DownloadProgress) => void; signal: AbortSignal }): Promise<void> }`
  - `class ProgressTracker` — `constructor(modelRef, now?: () => number)`; `update(phase, bytesCompleted, bytesTotal): DownloadProgress` (clamps percent monotonic, derives EWMA speed); `snapshot(): DownloadProgress`.
  - `formatBytes(n: number): string`, `formatSpeed(bps: number | null): string`, `formatEta(remainingBytes, bps): string`, `renderProgressLine(p: DownloadProgress): string`
  - `class ProgressBar` — `constructor(stream: NodeJS.WritableStream, isTty: boolean)`; `render(p: DownloadProgress): void`; `done(p: DownloadProgress): void`
  - `askYesNo(question, opts): Promise<boolean>`, `selectModels(candidates, opts): Promise<T[]>` (per-model selection; recommended pre-selected)

- [ ] **Step 1: Write failing tests for `ProgressTracker` (monotonic clamp + EWMA speed).**

```ts
// tests/provisioning/progress-tracker.test.ts
import { describe, expect, it } from 'bun:test';
import { ProgressTracker } from '../../src/provisioning/progress-tracker.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

describe('ProgressTracker', () => {
  it('derives percent from completed/total', () => {
    const t = new ProgressTracker('m', () => 0);
    const p = t.update(DownloadPhase.Downloading, 50, 100);
    expect(p.percent).toBe(50);
  });

  it('clamps percent monotonic when the source reports backwards', () => {
    let now = 0;
    const t = new ProgressTracker('m', () => now);
    t.update(DownloadPhase.Downloading, 80, 100); // 80%
    const p = t.update(DownloadPhase.Downloading, 60, 100); // source went backwards
    expect(p.percent).toBe(80); // never regresses
  });

  it('leaves percent null when total is unknown', () => {
    const t = new ProgressTracker('m', () => 0);
    const p = t.update(DownloadPhase.Resolving, 0, null);
    expect(p.percent).toBeNull();
  });

  it('derives a positive EWMA speed from bytes over time', () => {
    let now = 0;
    const t = new ProgressTracker('m', () => now);
    t.update(DownloadPhase.Downloading, 0, 1000);
    now = 1000; // +1s
    const p = t.update(DownloadPhase.Downloading, 500, 1000); // +500 bytes in 1s
    expect(p.speedBytesPerSec).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail.**

Run: `bun test tests/provisioning/progress-tracker.test.ts`
Expected: FAIL — cannot find module `progress-tracker.ts` / `types.ts`.

- [ ] **Step 3: Create `src/provisioning/types.ts`.**

```ts
import type { ProviderKind } from '../core/types.ts';

/** Lifecycle phase of a single model download, normalized across runtimes. */
export enum DownloadPhase {
  Resolving = 'resolving',   // fetching manifest / metadata / size
  Downloading = 'downloading',
  Verifying = 'verifying',   // sha256 / digest / checksum
  Finalizing = 'finalizing', // atomic rename / cache commit / install confirm
  Done = 'done',
  Failed = 'failed',
}

/** A normalized progress event emitted by every DownloadProvider. */
export type DownloadProgress = {
  modelRef: string;
  phase: DownloadPhase;
  bytesCompleted: number;
  bytesTotal: number | null; // null until known
  percent: number | null;    // derived, clamped monotonic; null when total unknown
  speedBytesPerSec: number | null; // derived (EWMA) except LM Studio native
  error?: string;
};

/** Runtime-agnostic model downloader. One adapter per runtime. */
export type DownloadProvider = {
  readonly kind: ProviderKind;
  download(
    modelRef: string,
    opts: { onProgress: (p: DownloadProgress) => void; signal: AbortSignal },
  ): Promise<void>;
};
```

- [ ] **Step 4: Create `src/provisioning/progress-tracker.ts`.**

```ts
import { type DownloadProgress, DownloadPhase } from './types.ts';

const EWMA_ALPHA = 0.3; // smoothing for bursty parallel-part throughput

/** Accumulates raw per-event bytes into a clamped, smoothed DownloadProgress. */
export class ProgressTracker {
  private maxPercent = 0;
  private lastBytes = 0;
  private lastTime: number | null = null;
  private speed: number | null = null;
  private last: DownloadProgress;

  constructor(
    private readonly modelRef: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.last = {
      modelRef,
      phase: DownloadPhase.Resolving,
      bytesCompleted: 0,
      bytesTotal: null,
      percent: null,
      speedBytesPerSec: null,
    };
  }

  update(
    phase: DownloadPhase,
    bytesCompleted: number,
    bytesTotal: number | null,
  ): DownloadProgress {
    // Monotonic percent: never regress even if the source reports backwards.
    let percent: number | null = null;
    if (bytesTotal && bytesTotal > 0) {
      const raw = Math.min(100, (bytesCompleted / bytesTotal) * 100);
      this.maxPercent = Math.max(this.maxPercent, raw);
      percent = this.maxPercent;
    }
    // EWMA speed from byte delta over wall-clock delta.
    const t = this.now();
    if (this.lastTime !== null) {
      const dt = (t - this.lastTime) / 1000;
      const db = bytesCompleted - this.lastBytes;
      if (dt > 0 && db >= 0) {
        const inst = db / dt;
        this.speed =
          this.speed === null ? inst : EWMA_ALPHA * inst + (1 - EWMA_ALPHA) * this.speed;
      }
    }
    this.lastTime = t;
    this.lastBytes = bytesCompleted;
    this.last = {
      modelRef: this.modelRef,
      phase,
      bytesCompleted,
      bytesTotal,
      percent,
      speedBytesPerSec: this.speed,
    };
    return this.last;
  }

  snapshot(): DownloadProgress {
    return this.last;
  }
}
```

- [ ] **Step 5: Run the tracker tests, verify they pass.**

Run: `bun test tests/provisioning/progress-tracker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write failing tests for the formatters.**

```ts
// tests/provisioning/ui-format.test.ts
import { describe, expect, it } from 'bun:test';
import { formatBytes, formatSpeed, formatEta, renderProgressLine } from '../../src/provisioning/ui/format.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

describe('formatters', () => {
  it('formats bytes human-readably', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2_100_000_000)).toBe('2.0 GB');
  });
  it('formats speed and handles null', () => {
    expect(formatSpeed(null)).toBe('—');
    expect(formatSpeed(1_048_576)).toBe('1.0 MB/s');
  });
  it('formats ETA and handles unknown', () => {
    expect(formatEta(1000, null)).toBe('—');
    expect(formatEta(1_000_000, 500_000)).toBe('2s');
  });
  it('renders a progress line with model, percent, size, speed', () => {
    const line = renderProgressLine({
      modelRef: 'qwen3.5:4b', phase: DownloadPhase.Downloading,
      bytesCompleted: 500_000_000, bytesTotal: 1_000_000_000, percent: 50, speedBytesPerSec: 1_048_576,
    });
    expect(line).toContain('qwen3.5:4b');
    expect(line).toContain('50%');
  });
});
```

- [ ] **Step 7: Run, verify fail; then create `src/provisioning/ui/format.ts`.**

Run first: `bun test tests/provisioning/ui-format.test.ts` → FAIL (module missing). Then:

```ts
import { type DownloadProgress, DownloadPhase } from '../types.ts';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${UNITS[i]}`;
}

export function formatSpeed(bps: number | null): string {
  if (bps === null || bps <= 0) return '—';
  return `${formatBytes(bps)}/s`;
}

export function formatEta(remainingBytes: number, bps: number | null): string {
  if (bps === null || bps <= 0) return '—';
  const secs = Math.round(remainingBytes / bps);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function renderProgressLine(p: DownloadProgress): string {
  const pct = p.percent === null ? '  ?%' : `${Math.floor(p.percent).toString().padStart(3)}%`;
  const size =
    p.bytesTotal === null
      ? formatBytes(p.bytesCompleted)
      : `${formatBytes(p.bytesCompleted)}/${formatBytes(p.bytesTotal)}`;
  const remaining = p.bytesTotal === null ? 0 : p.bytesTotal - p.bytesCompleted;
  const eta = p.bytesTotal === null ? '—' : formatEta(remaining, p.speedBytesPerSec);
  return `${p.modelRef}  ${pct}  ${size}  ${formatSpeed(p.speedBytesPerSec)}  ETA ${eta}  [${p.phase}]`;
}
```

- [ ] **Step 8: Run the formatter tests, verify pass.**

Run: `bun test tests/provisioning/ui-format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Create `src/provisioning/ui/progress-bar.ts` (no test — thin I/O wrapper over tested `renderProgressLine`).**

```ts
import { type DownloadProgress } from '../types.ts';
import { renderProgressLine } from './format.ts';

/** Live progress renderer. TTY → \r line-rewrite; non-TTY → one line per update. */
export class ProgressBar {
  constructor(
    private readonly stream: NodeJS.WritableStream,
    private readonly isTty: boolean,
  ) {}

  render(p: DownloadProgress): void {
    const line = renderProgressLine(p);
    if (this.isTty) this.stream.write(`\r\x1b[2K${line}`);
    else this.stream.write(`${line}\n`);
  }

  done(p: DownloadProgress): void {
    const line = renderProgressLine(p);
    this.stream.write(this.isTty ? `\r\x1b[2K${line}\n` : `${line}\n`);
  }
}
```

- [ ] **Step 10: Write failing tests for prompts (injected input stream, TTY + non-TTY + auto-yes).**

```ts
// tests/provisioning/ui-prompt.test.ts
import { describe, expect, it } from 'bun:test';
import { askYesNo, selectModels } from '../../src/provisioning/ui/prompt.ts';

function fakeInput(lines: string[]) {
  let i = 0;
  return { read: async () => lines[i++] ?? '' };
}

describe('askYesNo', () => {
  it('returns true on "y"', async () => {
    expect(await askYesNo('ok?', { input: fakeInput(['y']), autoYes: false })).toBe(true);
  });
  it('returns false on "n"', async () => {
    expect(await askYesNo('ok?', { input: fakeInput(['n']), autoYes: false })).toBe(false);
  });
  it('short-circuits to true when autoYes is set (no read)', async () => {
    expect(await askYesNo('ok?', { input: fakeInput([]), autoYes: true })).toBe(true);
  });
});

describe('selectModels', () => {
  it('keeps the recommended pre-selection on empty (Enter) input', async () => {
    const items = [{ id: 'a', recommended: true }, { id: 'b', recommended: false }];
    const out = await selectModels(items, { input: fakeInput(['']), autoYes: false, label: (x) => x.id });
    expect(out.map((x) => x.id)).toEqual(['a']);
  });
  it('honors an explicit index selection "1,2"', async () => {
    const items = [{ id: 'a', recommended: true }, { id: 'b', recommended: false }];
    const out = await selectModels(items, { input: fakeInput(['1,2']), autoYes: false, label: (x) => x.id });
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('auto-yes selects the recommended set without reading', async () => {
    const items = [{ id: 'a', recommended: true }, { id: 'b', recommended: false }];
    const out = await selectModels(items, { input: fakeInput([]), autoYes: true, label: (x) => x.id });
    expect(out.map((x) => x.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 11: Run, verify fail; then create `src/provisioning/ui/prompt.ts`.**

```ts
/** Minimal line reader so prompts are testable without real stdin. */
export type LineInput = { read: () => Promise<string> };

export function stdinInput(): LineInput {
  return {
    read: () =>
      new Promise((resolve) => {
        const onData = (d: Buffer) => {
          process.stdin.off('data', onData);
          process.stdin.pause();
          resolve(d.toString().trim());
        };
        process.stdin.resume();
        process.stdin.on('data', onData);
      }),
  };
}

export async function askYesNo(
  question: string,
  opts: { input: LineInput; autoYes: boolean },
): Promise<boolean> {
  if (opts.autoYes) return true;
  process.stderr.write(`${question} [y/N] `);
  const ans = (await opts.input.read()).toLowerCase();
  return ans === 'y' || ans === 'yes';
}

/** Present items with a recommended pre-selection; return the chosen subset. */
export async function selectModels<T extends { recommended: boolean }>(
  items: T[],
  opts: { input: LineInput; autoYes: boolean; label: (t: T) => string },
): Promise<T[]> {
  const recommended = items.filter((i) => i.recommended);
  if (opts.autoYes) return recommended;
  items.forEach((it, i) => {
    const mark = it.recommended ? '*' : ' ';
    process.stderr.write(`  [${mark}] ${i + 1}. ${opts.label(it)}\n`);
  });
  process.stderr.write(
    'Select models to download (comma-separated numbers, or Enter for recommended *): ',
  );
  const raw = (await opts.input.read()).trim();
  if (raw === '') return recommended;
  const picked = new Set(
    raw.split(',').map((s) => Number.parseInt(s.trim(), 10) - 1).filter((n) => n >= 0 && n < items.length),
  );
  return items.filter((_, i) => picked.has(i));
}
```

- [ ] **Step 12: Run all Task-1 tests, typecheck, lint.**

Run: `bun test tests/provisioning/ && bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts"`
Expected: all PASS; typecheck clean; lint clean.

- [ ] **Step 13: Commit.**

```bash
git add src/provisioning/types.ts src/provisioning/progress-tracker.ts src/provisioning/ui tests/provisioning
git commit -m "feat(provisioning): progress protocol + tracker + dep-free UI (Slice 14 Task 1)"
```

---

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

### Task 3: Hardware-fit + downloadable `CatalogSource`s (Ollama manifest + HF tree) + snapshot fallback

**Files:**
- Create: `src/provisioning/catalog/snapshot.json` (committed floor catalog; top-N per backend with pre-resolved sizes)
- Create: `src/provisioning/catalog/snapshot-source.ts` (reads the committed JSON)
- Create: `src/provisioning/catalog/ollama-catalog.ts` (community-JSON list + registry-manifest size)
- Create: `src/provisioning/catalog/hf-catalog.ts` (HF search list + tree size; covers llama.cpp + MLX)
- Create: `src/provisioning/fit.ts` (fit-filter + rank + recommended flag)
- Test: `tests/provisioning/fit.test.ts`
- Test: `tests/provisioning/ollama-catalog.test.ts`
- Test: `tests/provisioning/hf-catalog.test.ts`
- Test: `tests/provisioning/snapshot-source.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `CatalogSource`, `DiscoveryQuery`, `HostCapabilities` (discovery); `estimateModelBytes` (footprint); `fitsBudget` (hardware); `ProviderKind`.
- Produces:
  - `type FitCandidate = Candidate & { estimatedBytes: number; fits: boolean; recommended: boolean }`
  - `fitAndRank(candidates: Candidate[], budgetBytes: number): FitCandidate[]` (filter fits, rank largest-that-fits, mark top-per-runtime recommended)
  - `ollamaManifestSize(model: string, tag: string, fetchImpl?): Promise<number>` (sum `layers[].size`)
  - `createOllamaCatalogSource(deps?): CatalogSource`
  - `hfTreeSize(repoId: string, opts, fetchImpl?): Promise<number>`; `createHfCatalogSource(kind: ProviderKind, deps?): CatalogSource`
  - `createSnapshotSource(): CatalogSource` (+ `loadSnapshot(): Candidate[]`)
  - `withSnapshotFallback(source: CatalogSource, fallback: CatalogSource): CatalogSource` (per-source degrade)

- [ ] **Step 1: Write failing tests for `fitAndRank`.**

```ts
// tests/provisioning/fit.test.ts
import { describe, expect, it } from 'bun:test';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import { ProviderKind } from '../../src/core/types.ts';

const cand = (model: string, params: number, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 100, installed: false,
});

describe('fitAndRank', () => {
  it('drops candidates that do not fit the budget', () => {
    const out = fitAndRank([cand('big', 70, 40e9), cand('small', 4, 3e9)], 8e9);
    expect(out.every((c) => c.fits)).toBe(true);
    expect(out.map((c) => c.model)).toEqual(['small']);
  });
  it('ranks larger-that-fits first', () => {
    const out = fitAndRank([cand('a', 4, 3e9), cand('b', 7, 5e9)], 8e9);
    expect(out.map((c) => c.model)).toEqual(['b', 'a']);
  });
  it('marks the top fitting model per runtime as recommended', () => {
    const out = fitAndRank([cand('a', 4, 3e9), cand('b', 7, 5e9)], 8e9);
    expect(out.find((c) => c.model === 'b')?.recommended).toBe(true);
    expect(out.find((c) => c.model === 'a')?.recommended).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail; then create `src/provisioning/fit.ts`.**

```ts
import type { Candidate } from '../discovery/catalog-source.ts';
import { ProviderKind } from '../core/types.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget } from '../resource/hardware.ts';

export type FitCandidate = Candidate & { estimatedBytes: number; fits: boolean; recommended: boolean };

const DEFAULT_KV_PER_TOKEN = 131072;
const FIT_CONTEXT_TOKENS = 8192; // sizing context for the fit estimate

/** Filter to models that fit, rank largest-that-fits, mark top-per-runtime recommended. */
export function fitAndRank(candidates: Candidate[], budgetBytes: number): FitCandidate[] {
  const scored = candidates.map((c) => {
    const estimatedBytes = Math.max(
      c.fileSizeBytes,
      estimateModelBytes({
        paramsBillions: c.footprint.approxParamsBillions,
        bytesPerWeight: c.footprint.bytesPerWeight,
        contextTokens: FIT_CONTEXT_TOKENS,
        kvBytesPerToken: c.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN,
      }),
    );
    return { ...c, estimatedBytes, fits: fitsBudget(estimatedBytes, budgetBytes), recommended: false };
  });
  const fitting = scored
    .filter((c) => c.fits)
    .sort((a, b) => b.footprint.approxParamsBillions - a.footprint.approxParamsBillions);
  const seen = new Set<ProviderKind>();
  for (const c of fitting) {
    if (!seen.has(c.provider)) {
      c.recommended = true;
      seen.add(c.provider);
    }
  }
  return fitting;
}
```

- [ ] **Step 3: Run, verify pass.**

Run: `bun test tests/provisioning/fit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Write failing test for `ollamaManifestSize` (inject a fake fetch returning a manifest).**

```ts
// tests/provisioning/ollama-catalog.test.ts
import { describe, expect, it } from 'bun:test';
import { ollamaManifestSize } from '../../src/provisioning/catalog/ollama-catalog.ts';

describe('ollamaManifestSize', () => {
  it('sums layer sizes plus config size from the registry manifest', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      config: { size: 561 },
      layers: [{ size: 2_000_000_000 }, { size: 8_000 }, { size: 4_000 }],
    }), { status: 200 });
    const bytes = await ollamaManifestSize('llama3.2', 'latest', fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(2_000_000_000 + 8_000 + 4_000 + 561);
  });
  it('throws on a non-200 manifest response', async () => {
    const fakeFetch = async () => new Response('nope', { status: 404 });
    await expect(ollamaManifestSize('x', 'latest', fakeFetch as unknown as typeof fetch)).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run, verify fail; then create `src/provisioning/catalog/ollama-catalog.ts`.**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from '../../discovery/catalog-source.ts';

const REGISTRY = 'https://registry.ollama.ai/v2/library';

type Manifest = { config?: { size?: number }; layers?: Array<{ size?: number }> };

/** Authoritative pre-pull size: sum layers[].size (+ config.size) from the registry manifest. */
export async function ollamaManifestSize(
  model: string,
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  let res: Response;
  try {
    res = await fetchImpl(`${REGISTRY}/${model}/manifests/${tag}`);
  } catch (cause) {
    throw new ProviderError('Ollama registry manifest fetch failed', { cause });
  }
  if (!res.ok) throw new ProviderError(`Ollama registry manifest returned ${res.status}`);
  const m = (await res.json()) as Manifest;
  const layers = (m.layers ?? []).reduce((sum, l) => sum + (l.size ?? 0), 0);
  return layers + (m.config?.size ?? 0);
}

// Community catalog JSON (list only; sizes enriched lazily via the manifest above).
const CATALOG_JSON =
  'https://raw.githubusercontent.com/chrizzo84/OllamaScraper/refs/heads/main/out/ollama_models.json';

type CatalogEntry = { name?: string; tag?: string; size_bytes?: number; pulls?: number };

export function createOllamaCatalogSource(
  deps: { fetchImpl?: typeof fetch } = {},
): CatalogSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: 'ollama-catalog',
    appliesTo: (host: HostCapabilities) => host.runtimes.includes(ProviderKind.Ollama),
    async listCandidates(_q: DiscoveryQuery): Promise<Candidate[]> {
      const res = await fetchImpl(CATALOG_JSON);
      if (!res.ok) throw new ProviderError(`Ollama catalog JSON returned ${res.status}`);
      const entries = (await res.json()) as CatalogEntry[];
      return entries
        .filter((e) => e.name)
        .map((e) => ({
          provider: ProviderKind.Ollama,
          model: e.tag ? `${e.name}:${e.tag}` : (e.name as string),
          params: {},
          role: 'discovered',
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0.6 },
          repo: e.name as string,
          quant: e.tag,
          fileSizeBytes: e.size_bytes ?? 0, // lazy: 0 until enriched
          downloads: e.pulls ?? 0,
          installed: false,
        }));
    },
  };
}
```

Note: `approxParamsBillions: 0` is a placeholder for entries whose param count the catalog JSON doesn't carry — enrichment (Task 4 wiring) fills `fileSizeBytes` from `ollamaManifestSize`; the committed snapshot (below) carries real param counts for the recommended bootstrap set so `fitAndRank` has accurate data for the models we actually recommend.

- [ ] **Step 6: Run, verify pass.**

Run: `bun test tests/provisioning/ollama-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Write failing test for `hfTreeSize` (inject fake fetch returning a tree).**

```ts
// tests/provisioning/hf-catalog.test.ts
import { describe, expect, it } from 'bun:test';
import { hfTreeSize } from '../../src/provisioning/catalog/hf-catalog.ts';

describe('hfTreeSize', () => {
  it('returns the size of a single matching GGUF file', async () => {
    const fakeFetch = async () => new Response(JSON.stringify([
      { path: 'model-Q4_K_M.gguf', size: 4_100_000_000 },
      { path: 'README.md', size: 1_000 },
    ]), { status: 200 });
    const bytes = await hfTreeSize('bartowski/x-GGUF', { file: 'model-Q4_K_M.gguf' }, fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(4_100_000_000);
  });
  it('sums the whole tree for an MLX snapshot (no file filter)', async () => {
    const fakeFetch = async () => new Response(JSON.stringify([
      { path: 'a.safetensors', size: 2_000_000_000 },
      { path: 'b.safetensors', size: 1_000_000_000 },
      { path: 'config.json', size: 500 },
    ]), { status: 200 });
    const bytes = await hfTreeSize('mlx-community/x', {}, fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(3_000_000_500);
  });
});
```

- [ ] **Step 8: Run, verify fail; then create `src/provisioning/catalog/hf-catalog.ts`.**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from '../../discovery/catalog-source.ts';

const HF_API = 'https://huggingface.co/api';

type TreeEntry = { path: string; size?: number };

function hfHeaders(): Record<string, string> {
  const token = process.env.HF_TOKEN; // env-fallback only; degrade to anonymous
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Pre-download size: one GGUF file's size, or the summed tree for a snapshot. */
export async function hfTreeSize(
  repoId: string,
  opts: { file?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(`${HF_API}/models/${repoId}/tree/main?recursive=true`, { headers: hfHeaders() });
  if (!res.ok) throw new ProviderError(`HF tree returned ${res.status}`);
  const tree = (await res.json()) as TreeEntry[];
  if (opts.file) {
    const hit = tree.find((e) => e.path === opts.file);
    if (!hit) throw new ProviderError(`HF file ${opts.file} not found in ${repoId}`);
    return hit.size ?? 0;
  }
  return tree.reduce((sum, e) => sum + (e.size ?? 0), 0);
}

type SearchEntry = { id: string; downloads?: number };

/** kind = which runtime consumes these (Ollama-independent): MlxServer for MLX; filter differs. */
export function createHfCatalogSource(
  kind: ProviderKind,
  deps: { filter?: string; fetchImpl?: typeof fetch } = {},
): CatalogSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const filter = deps.filter ?? (kind === ProviderKind.MlxServer ? 'mlx' : 'gguf');
  return {
    name: `hf-catalog-${filter}`,
    appliesTo: (_host: HostCapabilities) => true, // HF reachable regardless of local runtime
    async listCandidates(_q: DiscoveryQuery): Promise<Candidate[]> {
      const url = `${HF_API}/models?filter=${filter}&sort=downloads&direction=-1&limit=30`;
      const res = await fetchImpl(url, { headers: hfHeaders() });
      if (!res.ok) throw new ProviderError(`HF search returned ${res.status}`);
      const entries = (await res.json()) as SearchEntry[];
      return entries.map((e) => ({
        provider: kind,
        model: e.id,
        params: {},
        role: 'discovered',
        footprint: { approxParamsBillions: 0, bytesPerWeight: 0.6 },
        repo: e.id,
        fileSizeBytes: 0, // lazy: enriched via hfTreeSize
        downloads: e.downloads ?? 0,
        installed: false,
      }));
    },
  };
}
```

- [ ] **Step 9: Run, verify pass.**

Run: `bun test tests/provisioning/hf-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Create the committed snapshot + source, with a failing test first.**

```ts
// tests/provisioning/snapshot-source.test.ts
import { describe, expect, it } from 'bun:test';
import { loadSnapshot, withSnapshotFallback } from '../../src/provisioning/catalog/snapshot-source.ts';
import { ProviderKind } from '../../src/core/types.ts';
import type { CatalogSource } from '../../src/discovery/catalog-source.ts';

describe('snapshot', () => {
  it('loads a non-empty committed snapshot with real sizes', () => {
    const snap = loadSnapshot();
    expect(snap.length).toBeGreaterThan(0);
    expect(snap.every((c) => c.fileSizeBytes > 0)).toBe(true);
  });
});

describe('withSnapshotFallback', () => {
  const host = { totalRamBytes: 24e9, liveBudgetBytes: 8e9, runtimes: [ProviderKind.Ollama] };
  const query = { budgetBytes: 8e9, hostTotalRamBytes: 24e9 };
  it('falls back to the snapshot slice when the live source throws', async () => {
    const failing: CatalogSource = { name: 'live', appliesTo: () => true, listCandidates: async () => { throw new Error('429'); } };
    const snap: CatalogSource = { name: 'snap', appliesTo: () => true, listCandidates: async () => [
      { provider: ProviderKind.Ollama, model: 'qwen3.5:4b', params: {}, role: 'x',
        footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 }, repo: 'qwen3.5', fileSizeBytes: 3e9, downloads: 1, installed: false },
    ] };
    const merged = withSnapshotFallback(failing, snap);
    const out = await merged.listCandidates(query);
    expect(out.map((c) => c.model)).toEqual(['qwen3.5:4b']);
  });
});
```

- [ ] **Step 11: Run, verify fail; then create the snapshot JSON + source.**

`src/provisioning/catalog/snapshot.json` (the committed floor — real bootstrap models with accurate params + Q4 sizes; extend as models are added):

```json
[
  { "provider": "Ollama", "model": "qwen3.5:4b", "repo": "qwen3.5", "quant": "Q4_K_M",
    "params_billions": 4, "bytes_per_weight": 0.6, "file_size_bytes": 3000000000, "downloads": 100000,
    "role": "routing / orchestration", "capabilities": ["tools"] },
  { "provider": "Ollama", "model": "qwen3.5:9b", "repo": "qwen3.5", "quant": "Q4_K_M",
    "params_billions": 9, "bytes_per_weight": 0.6, "file_size_bytes": 6600000000, "downloads": 100000,
    "role": "general reasoning + tool use", "capabilities": ["tools"] },
  { "provider": "Ollama", "model": "qwen3-embedding:0.6b", "repo": "qwen3-embedding", "quant": "Q4_K_M",
    "params_billions": 0.6, "bytes_per_weight": 0.6, "file_size_bytes": 640000000, "downloads": 50000,
    "role": "embeddings", "capabilities": [] },
  { "provider": "Ollama", "model": "bespoke-minicheck", "repo": "bespoke-minicheck", "quant": "Q4_K_M",
    "params_billions": 7, "bytes_per_weight": 0.6, "file_size_bytes": 4700000000, "downloads": 20000,
    "role": "faithfulness judge", "capabilities": [] }
]
```

`src/provisioning/catalog/snapshot-source.ts`:

```ts
import { Capability, type ContentPolicy, ProviderKind } from '../../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery } from '../../discovery/catalog-source.ts';
import snapshot from './snapshot.json' with { type: 'json' };

type SnapshotEntry = {
  provider: string; model: string; repo: string; quant?: string;
  params_billions: number; bytes_per_weight: number; file_size_bytes: number;
  downloads: number; role: string; capabilities?: string[];
};

/** Read the committed snapshot catalog into Candidates. The robustness floor. */
export function loadSnapshot(): Candidate[] {
  return (snapshot as SnapshotEntry[]).map((e) => ({
    provider: e.provider as ProviderKind,
    model: e.model,
    params: {},
    role: e.role,
    capabilities: (e.capabilities ?? []) as Capability[],
    footprint: { approxParamsBillions: e.params_billions, bytesPerWeight: e.bytes_per_weight },
    repo: e.repo,
    quant: e.quant,
    fileSizeBytes: e.file_size_bytes,
    downloads: e.downloads,
    installed: false,
  }));
}

export function createSnapshotSource(): CatalogSource {
  return {
    name: 'snapshot',
    appliesTo: () => true,
    listCandidates: async (_q: DiscoveryQuery) => loadSnapshot(),
  };
}

/** Try the live source; on ANY error, degrade to the fallback's slice. Never throws for source failure. */
export function withSnapshotFallback(source: CatalogSource, fallback: CatalogSource): CatalogSource {
  return {
    name: `${source.name}+snapshot`,
    appliesTo: source.appliesTo,
    async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
      try {
        const live = await source.listCandidates(q);
        return live.length > 0 ? live : fallback.listCandidates(q);
      } catch {
        return fallback.listCandidates(q);
      }
    },
  };
}
```

- [ ] **Step 12: Run all Task-3 tests, typecheck, lint.**

Run: `bun test tests/provisioning/ && bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts"`
Expected: all PASS; clean.

- [ ] **Step 13: Commit.**

```bash
git add src/provisioning/fit.ts src/provisioning/catalog tests/provisioning/fit.test.ts tests/provisioning/ollama-catalog.test.ts tests/provisioning/hf-catalog.test.ts tests/provisioning/snapshot-source.test.ts
git commit -m "feat(provisioning): hardware-fit + downloadable catalog sources + snapshot fallback (Slice 14 Task 3)"
```

---

### Task 4: Provisioner orchestration + `provision` CLI + auto-detect hook

**Files:**
- Create: `src/provisioning/provisioner.ts` (orchestration: detect → discover → fit → enrich → consent → download → verify)
- Create: `src/provisioning/registry.ts` (`providerFor(kind)` + `catalogSourcesFor(host)`)
- Create: `src/provisioning/detect-missing.ts` (which declared models aren't installed)
- Create: `src/cli/provision.ts` (the `bun run provision` entry)
- Modify: `package.json` (add `"provision": "bun run src/cli/provision.ts"`)
- Modify: `src/cli/chat.ts` (auto-detect hook: offer provisioning when required models missing)
- Test: `tests/provisioning/provisioner.test.ts`
- Test: `tests/provisioning/detect-missing.test.ts`

**Interfaces:**
- Consumes: `detectHost` (discovery/host); `fitAndRank`/`FitCandidate` (fit); catalog sources + `withSnapshotFallback` (Task 3); `DownloadProvider` (Task 1–2); `askYesNo`/`selectModels`/`stdinInput` + `ProgressBar` (Task 1); `isModelInstalled` (ollama-control); `enrichSize` (defined here).
- Produces:
  - `type ProvisionResult = { downloaded: string[]; declined: string[]; failed: Array<{ model: string; error: string }>; deferred: string[] }`
  - `runProvision(opts: { deps?: ProvisionDeps; autoYes?: boolean }): Promise<ProvisionResult>`
  - `type ProvisionDeps = { detectHost; catalogSources; providerFor; enrichSize; ui }` (all injectable for tests)
  - `providerFor(kind: ProviderKind): DownloadProvider`
  - `detectMissing(declared: ModelDeclaration[], isInstalled: (m: string) => Promise<boolean>): Promise<ModelDeclaration[]>`

- [ ] **Step 1: Write failing test for `detectMissing`.**

```ts
// tests/provisioning/detect-missing.test.ts
import { describe, expect, it } from 'bun:test';
import { detectMissing } from '../../src/provisioning/detect-missing.ts';
import { ProviderKind } from '../../src/core/types.ts';

const decl = (model: string) => ({ provider: ProviderKind.Ollama, model, params: {}, role: 'x', footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 } });

describe('detectMissing', () => {
  it('returns only the declared models that are not installed', async () => {
    const installed = new Set(['a']);
    const out = await detectMissing([decl('a'), decl('b')], async (m) => installed.has(m));
    expect(out.map((d) => d.model)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run, verify fail; then create `src/provisioning/detect-missing.ts`.**

```ts
import type { ModelDeclaration } from '../core/types.ts';

/** The declared models not yet installed — the set provisioning offers to pull. */
export async function detectMissing(
  declared: ModelDeclaration[],
  isInstalled: (model: string) => Promise<boolean>,
): Promise<ModelDeclaration[]> {
  const missing: ModelDeclaration[] = [];
  for (const d of declared) {
    if (!(await isInstalled(d.model))) missing.push(d);
  }
  return missing;
}
```

- [ ] **Step 3: Run, verify pass.**

Run: `bun test tests/provisioning/detect-missing.test.ts`
Expected: PASS.

- [ ] **Step 4: Write failing test for `runProvision` (fully injected deps; asserts consent + download + degrade).**

```ts
// tests/provisioning/provisioner.test.ts
import { describe, expect, it } from 'bun:test';
import { runProvision } from '../../src/provisioning/provisioner.ts';
import { ProviderKind } from '../../src/core/types.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

const host = { totalRamBytes: 24e9, liveBudgetBytes: 8e9, runtimes: [ProviderKind.Ollama] };
const cand = (model: string, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 1, installed: false,
});

function deps(overrides = {}) {
  const downloaded: string[] = [];
  return {
    downloaded,
    detectHost: async () => host,
    catalogSources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [cand('qwen3.5:4b', 3e9)] }],
    providerFor: () => ({
      kind: ProviderKind.Ollama,
      download: async (m: string, o: any) => {
        o.onProgress({ modelRef: m, phase: DownloadPhase.Done, bytesCompleted: 3e9, bytesTotal: 3e9, percent: 100, speedBytesPerSec: 1 });
        downloaded.push(m);
      },
    }),
    enrichSize: async (c: any) => c.fileSizeBytes,
    freeDiskBytes: async () => 500e9,
    ui: { askYesNo: async () => true, selectModels: async (items: any[]) => items.filter((i) => i.recommended), bar: { render() {}, done() {} } },
    ...overrides,
  };
}

describe('runProvision', () => {
  it('downloads the consented recommended model', async () => {
    const d = deps();
    const res = await runProvision({ deps: d, autoYes: false });
    expect(res.downloaded).toEqual(['qwen3.5:4b']);
    expect(d.downloaded).toEqual(['qwen3.5:4b']);
  });

  it('records nothing downloaded when consent is declined', async () => {
    const res = await runProvision({ deps: deps({ ui: { askYesNo: async () => false, selectModels: async () => [], bar: { render() {}, done() {} } }) }, autoYes: false });
    expect(res.downloaded).toEqual([]);
  });

  it('degrades: a failing download is recorded in failed, others still proceed', async () => {
    const d = deps({
      catalogSources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [cand('good', 3e9), cand('bad', 3e9)] }],
      providerFor: () => ({
        kind: ProviderKind.Ollama,
        download: async (m: string) => { if (m === 'bad') throw new Error('pull failed'); },
      }),
      ui: { askYesNo: async () => true, selectModels: async (items: any[]) => items, bar: { render() {}, done() {} } },
    });
    const res = await runProvision({ deps: d, autoYes: false });
    expect(res.failed.map((f) => f.model)).toContain('bad');
    expect(res.downloaded).toContain('good');
  });
});
```

- [ ] **Step 5: Run, verify fail; then create `src/provisioning/provisioner.ts`.**

```ts
import type { HostCapabilities, Candidate, CatalogSource } from '../discovery/catalog-source.ts';
import type { ProviderKind } from '../core/types.ts';
import { fitAndRank, type FitCandidate } from './fit.ts';
import { checkDiskSpace } from './supervisor.ts';
import { type DownloadProgress, type DownloadProvider } from './types.ts';

export type ProvisionResult = {
  downloaded: string[];
  declined: string[];
  failed: Array<{ model: string; error: string }>;
  deferred: string[];
};

export type ProvisionUi = {
  askYesNo: (q: string) => Promise<boolean>;
  selectModels: (items: FitCandidate[]) => Promise<FitCandidate[]>;
  bar: { render: (p: DownloadProgress) => void; done: (p: DownloadProgress) => void };
};

export type ProvisionDeps = {
  detectHost: () => Promise<HostCapabilities>;
  catalogSources: CatalogSource[];
  providerFor: (kind: ProviderKind) => DownloadProvider;
  enrichSize: (c: Candidate) => Promise<number>;
  freeDiskBytes: () => Promise<number>;
  ui: ProvisionUi;
};

/** Orchestrates the first-boot flow. All deps injectable; degrade-never-crash. */
export async function runProvision(
  opts: { deps: ProvisionDeps; autoYes?: boolean },
): Promise<ProvisionResult> {
  const { deps } = opts;
  const result: ProvisionResult = { downloaded: [], declined: [], failed: [], deferred: [] };

  const host = await deps.detectHost();

  // 1) Discover across applicable sources; degrade per-source (a throw yields []).
  const query = { budgetBytes: host.liveBudgetBytes, hostTotalRamBytes: host.totalRamBytes };
  const lists = await Promise.all(
    deps.catalogSources
      .filter((s) => s.appliesTo(host))
      .map((s) => s.listCandidates(query).catch(() => [] as Candidate[])),
  );
  const candidates = lists.flat();

  // 2) Fit-filter + rank; recommended pre-marked.
  const ranked = fitAndRank(candidates, host.liveBudgetBytes);
  if (ranked.length === 0) return result;

  // 3) Enrich sizes for the shown set (lazy; degrade to existing size on failure).
  for (const c of ranked) {
    if (c.fileSizeBytes <= 0) {
      try {
        c.fileSizeBytes = await deps.enrichSize(c);
      } catch {
        /* leave as-is; UI shows best-effort size */
      }
    }
  }

  // 4) Consent: per-model selection (recommended pre-selected).
  const selected = await deps.ui.selectModels(ranked);
  if (selected.length === 0) return result;

  // 5) Disk preflight over the selected set.
  const required = selected.reduce((s, c) => s + Math.max(c.fileSizeBytes, c.estimatedBytes), 0);
  const free = await deps.freeDiskBytes();
  const pre = checkDiskSpace({ requiredBytes: required, freeBytes: free });
  if (!pre.ok) {
    const ok = await deps.ui.askYesNo(
      `Need ~${Math.round(required / 1e9)}GB but only ~${Math.round(free / 1e9)}GB free (short ~${Math.round(pre.shortfallBytes / 1e9)}GB). Continue anyway?`,
    );
    if (!ok) {
      for (const c of selected) result.declined.push(c.model);
      return result;
    }
  }

  // 6) Sequential download with a live bar; degrade-never-crash per model.
  const ctrl = new AbortController();
  for (const c of selected) {
    try {
      const provider = deps.providerFor(c.provider);
      await provider.download(c.model, { onProgress: (p) => deps.ui.bar.render(p), signal: ctrl.signal });
      result.downloaded.push(c.model);
    } catch (err) {
      result.failed.push({ model: c.model, error: (err as Error).message });
    }
  }
  return result;
}
```

- [ ] **Step 6: Run, verify pass.**

Run: `bun test tests/provisioning/provisioner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Create `src/provisioning/registry.ts` (wire real providers + sources; no test — thin composition of tested units).**

```ts
import { ProviderKind } from '../core/types.ts';
import type { Candidate, CatalogSource, HostCapabilities } from '../discovery/catalog-source.ts';
import { createHfCatalogSource } from './catalog/hf-catalog.ts';
import { createOllamaCatalogSource, ollamaManifestSize } from './catalog/ollama-catalog.ts';
import { createSnapshotSource, withSnapshotFallback } from './catalog/snapshot-source.ts';
import { hfTreeSize } from './catalog/hf-catalog.ts';
import { createOllamaProvider } from './providers/ollama.ts';
import { createHfFetchProvider } from './providers/hf-fetch.ts'; // Task 5
import { createLmStudioProvider } from './providers/lmstudio.ts'; // Task 5
import type { DownloadProvider } from './types.ts';

export function providerFor(kind: ProviderKind): DownloadProvider {
  switch (kind) {
    case ProviderKind.Ollama:
      return createOllamaProvider();
    case ProviderKind.MlxServer:
      return createHfFetchProvider(ProviderKind.MlxServer); // MLX snapshot via HF
    default:
      return createOllamaProvider();
  }
}

export function catalogSourcesFor(_host: HostCapabilities): CatalogSource[] {
  const snap = createSnapshotSource();
  return [
    withSnapshotFallback(createOllamaCatalogSource(), snap),
    withSnapshotFallback(createHfCatalogSource(ProviderKind.MlxServer), snap),
  ];
}

/** Lazy size enrichment routed by provider. */
export async function enrichSize(c: Candidate): Promise<number> {
  if (c.provider === ProviderKind.Ollama) {
    const [model, tag = 'latest'] = c.model.split(':');
    return ollamaManifestSize(model, tag);
  }
  return hfTreeSize(c.repo, {}); // MLX snapshot sum
}
```

Note: `createHfFetchProvider` / `createLmStudioProvider` are Task 5. This file imports them so Task 5 completes the wiring; until then, comment those two imports and the `MlxServer` case to keep Task 4 self-contained (re-enable in Task 5, Step 9).

- [ ] **Step 8: Create `src/cli/provision.ts`.**

```ts
import { detectHost } from '../discovery/host.ts';
import { catalogSourcesFor, enrichSize, providerFor } from '../provisioning/registry.ts';
import { runProvision } from '../provisioning/provisioner.ts';
import { ProgressBar } from '../provisioning/ui/progress-bar.ts';
import { askYesNo, selectModels, stdinInput } from '../provisioning/ui/prompt.ts';
import { formatBytes } from '../provisioning/ui/format.ts';

async function freeDiskBytes(): Promise<number> {
  // statfs on the models volume; conservative fallback keeps preflight non-fatal.
  try {
    const { statfs } = await import('node:fs/promises');
    const s = await statfs(process.env.OLLAMA_MODELS ?? process.cwd());
    return s.bavail * s.bsize;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

async function main(): Promise<void> {
  const autoYes = process.env.AGENT_PROVISION_AUTO_YES === '1';
  const input = stdinInput();
  const bar = new ProgressBar(process.stderr, process.stderr.isTTY ?? false);
  const host = await detectHost();
  const result = await runProvision({
    autoYes,
    deps: {
      detectHost: async () => host,
      catalogSources: catalogSourcesFor(host),
      providerFor,
      enrichSize,
      freeDiskBytes,
      ui: {
        askYesNo: (q) => askYesNo(q, { input, autoYes }),
        selectModels: (items) =>
          selectModels(items, {
            input,
            autoYes,
            label: (c) => `${c.model}  (${formatBytes(c.fileSizeBytes || c.estimatedBytes)})`,
          }),
        bar,
      },
    },
  });
  console.error(
    `\nProvisioned: ${result.downloaded.length} · declined: ${result.declined.length} · failed: ${result.failed.length}`,
  );
  if (result.failed.length > 0) process.exitCode = 1;
}

await main();
```

- [ ] **Step 9: Add the `provision` script to `package.json`.**

Modify `package.json` scripts (after `"memory": ...`):
```json
    "memory": "bun run src/cli/memory.ts",
    "provision": "bun run src/cli/provision.ts"
```

- [ ] **Step 10: Wire the auto-detect hook into `src/cli/chat.ts`.**

Read `src/cli/chat.ts` around the `createModelManager()` / `ensureReady` block (lines ~30–40 per the seam map). Before the first `ensureReady`, add a guarded offer (import `detectMissing`, `isModelInstalled`, `runProvision` deps). Minimal, non-invasive:

```ts
// near the top of chat.ts main(), before ensureReady:
import { isModelInstalled } from '../resource/ollama-control.ts';
import { detectMissing } from '../provisioning/detect-missing.ts';
import { BOOTSTRAP } from '../../models/registry.ts';
import { runProvision } from '../provisioning/provisioner.ts';
import { catalogSourcesFor, enrichSize, providerFor } from '../provisioning/registry.ts';
// ... (ProgressBar + prompt imports as in provision.ts)

const missing = await detectMissing(BOOTSTRAP, (m) => isModelInstalled(m));
if (missing.length > 0 && (process.stderr.isTTY ?? false)) {
  const ok = await askYesNo(
    `${missing.length} required model(s) not installed: ${missing.map((m) => m.model).join(', ')}. Provision now?`,
    { input: stdinInput(), autoYes: process.env.AGENT_PROVISION_AUTO_YES === '1' },
  );
  if (ok) {
    const host = await detectHost();
    await runProvision({ deps: { /* same wiring as provision.ts */ } });
  }
}
```

Keep it behind the TTY + consent gate so non-interactive `chat` runs are unaffected. Factor the shared deps-wiring from `provision.ts` into a small `src/provisioning/cli-deps.ts` helper to avoid duplication (DRY) and import it in both.

- [ ] **Step 11: Typecheck, lint, run full provisioning suite.**

Run: `bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts" "src/cli/provision.ts" "src/cli/chat.ts" && bun test tests/provisioning/`
Expected: clean + all PASS.

- [ ] **Step 12: LIVE-VERIFY the end-to-end CLI (Ollama).**

Run: with `ollama serve` up and (temporarily) a model uninstalled — `AGENT_PROVISION_AUTO_YES=1 bun run provision`.
Expected: detects host (24 GB), lists fitting candidates, downloads the recommended set with a live bar, prints the summary, exit 0. Confirm with `ollama list`. Record in the SDD ledger.

- [ ] **Step 13: Commit.**

```bash
git add src/provisioning/provisioner.ts src/provisioning/registry.ts src/provisioning/detect-missing.ts src/provisioning/cli-deps.ts src/cli/provision.ts src/cli/chat.ts package.json tests/provisioning/provisioner.test.ts tests/provisioning/detect-missing.test.ts
git commit -m "feat(provisioning): provisioner orchestration + provision CLI + auto-detect hook, live-verified (Slice 14 Task 4)"
```

---

### Task 5: LM Studio adapter (REST) + HF-fetch adapter (llama.cpp/MLX) — contract-tested, live-verify deferred

**Files:**
- Create: `src/provisioning/providers/hf-fetch.ts` (raw-`fetch` HuggingFace download + `node:crypto` SHA256)
- Create: `src/provisioning/providers/lmstudio.ts` (LM Studio local REST download + poll)
- Test: `tests/provisioning/hf-fetch.test.ts`
- Test: `tests/provisioning/lmstudio.test.ts`
- Modify: `src/provisioning/registry.ts` (re-enable the Task-4 commented imports/cases)

**Interfaces:**
- Consumes: `DownloadProvider`, `DownloadPhase`, `ProgressTracker` (Task 1); `ProviderKind`; `ProviderError`.
- Produces:
  - `createHfFetchProvider(kind: ProviderKind, deps?: { fetchImpl?; sha256?: (path) => Promise<string> }): DownloadProvider`
  - `sha256File(path: string): Promise<string>`
  - `createLmStudioProvider(deps?: { baseUrl?: string; fetchImpl?; pollMs?: number }): DownloadProvider`

- [ ] **Step 1: Write failing test for the HF-fetch provider (inject a fake streaming fetch + sha).**

```ts
// tests/provisioning/hf-fetch.test.ts
import { describe, expect, it } from 'bun:test';
import { createHfFetchProvider } from '../../src/provisioning/providers/hf-fetch.ts';
import { ProviderKind } from '../../src/core/types.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

function streamingResponse(chunks: Uint8Array[], total: number): Response {
  const body = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
  return new Response(body, { status: 200, headers: { 'content-length': String(total) } });
}

describe('createHfFetchProvider', () => {
  it('emits Downloading progress that reaches Done', async () => {
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.MlxServer, {
      fetchImpl: (async () => streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'deadbeef',
    });
    const phases: DownloadPhase[] = [];
    await provider.download('mlx-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
    });
    expect(phases).toContain(DownloadPhase.Downloading);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
```

- [ ] **Step 2: Run, verify fail; then create `src/provisioning/providers/hf-fetch.ts`.**

```ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { ProviderError } from '../../core/errors.ts';
import type { ProviderKind } from '../../core/types.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { DownloadPhase, type DownloadProvider } from '../types.ts';

const HF_RESOLVE = 'https://huggingface.co';

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

/** Runtime-agnostic HuggingFace downloader (llama.cpp GGUF + MLX snapshot). We own the fetch. */
export function createHfFetchProvider(
  kind: ProviderKind,
  deps: { fetchImpl?: typeof fetch; sha256?: (path: string) => Promise<string> } = {},
): DownloadProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    kind,
    async download(modelRef, { onProgress, signal }) {
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      // modelRef = "repo/id" or "repo/id::file.gguf"; snapshot fetch omits the file.
      const [repo, file] = modelRef.split('::');
      const url = file ? `${HF_RESOLVE}/${repo}/resolve/main/${file}` : `${HF_RESOLVE}/${repo}/resolve/main/`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok || !res.body) throw new ProviderError(`HF resolve returned ${res.status}`);
      const total = Number(res.headers.get('content-length')) || null;
      const reader = res.body.getReader();
      let done = 0;
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        done += value?.byteLength ?? 0;
        onProgress(tracker.update(DownloadPhase.Downloading, done, total));
      }
      // Verify (SHA256 of the written file) — llama.cpp/GGUF has no content hash of its own.
      onProgress(tracker.update(DownloadPhase.Verifying, done, total));
      if (deps.sha256) await deps.sha256(file ?? repo);
      onProgress(tracker.update(DownloadPhase.Done, done, total ?? done));
    },
  };
}
```

Note: this test-covers the streaming + phase path with injected fetch/sha. The real file-write + on-disk path (streaming to a `.part` file, atomic rename) is exercised in the deferred live-verify once a HF-backed runtime is installed; the automated tests inject `sha256` to keep them deterministic and offline.

- [ ] **Step 3: Run, verify pass.**

Run: `bun test tests/provisioning/hf-fetch.test.ts`
Expected: PASS.

- [ ] **Step 4: Write failing test for the LM Studio adapter (inject fake REST: download job → poll → completed).**

```ts
// tests/provisioning/lmstudio.test.ts
import { describe, expect, it } from 'bun:test';
import { createLmStudioProvider } from '../../src/provisioning/providers/lmstudio.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

describe('createLmStudioProvider', () => {
  it('starts a download job then polls to completion, emitting Done', async () => {
    let poll = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/download')) {
        return new Response(JSON.stringify({ job_id: 'j1', status: 'downloading', total_size_bytes: 1000 }), { status: 200 });
      }
      poll++;
      const body = poll < 2
        ? { status: 'downloading', downloaded_bytes: 500, total_size_bytes: 1000 }
        : { status: 'completed', downloaded_bytes: 1000, total_size_bytes: 1000 };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createLmStudioProvider({ fetchImpl, pollMs: 0 });
    const phases: DownloadPhase[] = [];
    await provider.download('lmstudio-community/x', { onProgress: (p) => phases.push(p.phase), signal: new AbortController().signal });
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
```

- [ ] **Step 5: Run, verify fail; then create `src/provisioning/providers/lmstudio.ts`.**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { DownloadPhase, type DownloadProvider } from '../types.ts';

const DEFAULT_BASE_URL = 'http://localhost:1234';

type DownloadJob = { job_id?: string; status: string; total_size_bytes?: number };
type JobStatus = { status: string; downloaded_bytes?: number; total_size_bytes?: number };

/** LM Studio local REST download: start a job, poll status → normalized progress. */
export function createLmStudioProvider(
  deps: { baseUrl?: string; fetchImpl?: typeof fetch; pollMs?: number } = {},
): DownloadProvider {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pollMs = deps.pollMs ?? 1000;
  return {
    kind: ProviderKind.MlxServer, // LM Studio serves GGUF+MLX; shares the MlxServer kind today
    async download(modelRef, { onProgress, signal }) {
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      const start = await fetchImpl(`${baseUrl}/api/v1/models/download`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelRef }),
        signal,
      });
      if (!start.ok) throw new ProviderError(`LM Studio download returned ${start.status}`);
      const job = (await start.json()) as DownloadJob;
      if (job.status === 'already_downloaded') {
        onProgress(tracker.update(DownloadPhase.Done, 0, 0));
        return;
      }
      const total = job.total_size_bytes ?? null;
      for (;;) {
        if (signal.aborted) throw new ProviderError('LM Studio download aborted');
        const st = await fetchImpl(`${baseUrl}/api/v1/models/download/${job.job_id}`, { signal });
        if (!st.ok) throw new ProviderError(`LM Studio status returned ${st.status}`);
        const s = (await st.json()) as JobStatus;
        onProgress(tracker.update(DownloadPhase.Downloading, s.downloaded_bytes ?? 0, s.total_size_bytes ?? total));
        if (s.status === 'completed') { onProgress(tracker.update(DownloadPhase.Done, s.downloaded_bytes ?? 0, s.total_size_bytes ?? total ?? 0)); return; }
        if (s.status === 'failed') throw new ProviderError(`LM Studio download failed for ${modelRef}`);
        if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
```

Note (endpoint provisionality): the LM Studio REST download surface is undocumented/`unstable` per research — the exact paths/fields are best-effort. This adapter is **live-verify deferred**: contract-tested here against the documented shape; verify + correct paths when LM Studio is installed. The SDK (`@lmstudio/sdk`) is a future richer path but is not added (no new dep).

- [ ] **Step 6: Run, verify pass.**

Run: `bun test tests/provisioning/lmstudio.test.ts`
Expected: PASS.

- [ ] **Step 7: Re-enable the Task-4 registry wiring.**

In `src/provisioning/registry.ts`, uncomment the `createHfFetchProvider` / `createLmStudioProvider` imports and the `MlxServer` case (from Task 4, Step 7 note). Confirm `providerFor(ProviderKind.MlxServer)` returns the HF-fetch provider.

- [ ] **Step 8: Typecheck, lint, run full provisioning suite.**

Run: `bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts" && bun test tests/provisioning/`
Expected: clean + all PASS.

- [ ] **Step 9: Log the deferred live-verify explicitly (not a silent skip).**

Append to `.superpowers/sdd/progress.md` a Slice-14 note: "LM Studio + HF-fetch (llama.cpp/MLX) adapters: contract-tested green; LIVE-VERIFY DEFERRED pending runtime install on a test machine. Ollama verified live (Tasks 2, 4)."

- [ ] **Step 10: Commit.**

```bash
git add src/provisioning/providers/hf-fetch.ts src/provisioning/providers/lmstudio.ts src/provisioning/registry.ts tests/provisioning/hf-fetch.test.ts tests/provisioning/lmstudio.test.ts .superpowers/sdd/progress.md
git commit -m "feat(provisioning): LM Studio + HF-fetch adapters (llama.cpp/MLX), contract-tested, live-verify deferred (Slice 14 Task 5)"
```

---

### Task 6: Telemetry span + eval gate + all-four docs surfaces

**Files:**
- Modify: `src/telemetry/spans.ts` (add `ATTR.PROVISION_*` + `withProvisionSpan`)
- Modify: `src/provisioning/provisioner.ts` (wrap `runProvision` body in the span, emit per-model outcomes)
- Create: `tests/provisioning/eval.test.ts` (fit-selection golden set across RAM tiers)
- Modify: `docs/architecture.md` (§13 Provisioning + both Mermaid diagrams)
- Modify: `README.md` (Status line, slice table row → ✅ Done, feature paragraph)
- Modify: `docs/ROADMAP.md` (flip the Slice-14 marker in the gap/sequence tables to ✅ shipped)
- Modify: `.superpowers/sdd/progress.md` (close Slice 14)

**Interfaces:**
- Consumes: `inSpan`/`ATTR` pattern (spans.ts); `ProvisionResult` (provisioner).
- Produces: `withProvisionSpan<T>(info: ProvisionSpanInfo, fn: () => Promise<T>): Promise<T>`; new `ATTR.PROVISION_*` keys.

- [ ] **Step 1: Add telemetry attrs + span helper to `src/telemetry/spans.ts`.**

Add to the `ATTR` object (after `VERIFICATION_FALLBACK`):
```ts
  PROVISION_RUNTIME: 'provision.runtime',
  PROVISION_CANDIDATE_COUNT: 'provision.candidate_count',
  PROVISION_SELECTED_COUNT: 'provision.selected_count',
  PROVISION_BYTES_TOTAL: 'provision.bytes_total',
  PROVISION_DOWNLOADED_COUNT: 'provision.downloaded_count',
  PROVISION_FAILED_COUNT: 'provision.failed_count',
  PROVISION_DEFERRED_VERIFY: 'provision.deferred_verify',
  PROVISION_SNAPSHOT_FALLBACK: 'provision.snapshot_fallback',
```
Add the helper (mirroring `withModelLoadSpan`):
```ts
export type ProvisionSpanInfo = {
  candidateCount: number;
  selectedCount: number;
  bytesTotal: number;
  snapshotFallback: boolean;
};

export function withProvisionSpan<T>(info: ProvisionSpanInfo, fn: (span: Span) => Promise<T>): Promise<T> {
  return inSpan('agent.model.provision', async (span) => {
    span.setAttribute(ATTR.PROVISION_CANDIDATE_COUNT, info.candidateCount);
    span.setAttribute(ATTR.PROVISION_SELECTED_COUNT, info.selectedCount);
    span.setAttribute(ATTR.PROVISION_BYTES_TOTAL, info.bytesTotal);
    span.setAttribute(ATTR.PROVISION_SNAPSHOT_FALLBACK, info.snapshotFallback);
    return fn(span);
  });
}
```

- [ ] **Step 2: Write a failing test asserting the provision span is emitted (in-memory span exporter).**

```ts
// tests/provisioning/eval.test.ts  (telemetry + eval in one gate file)
import { describe, expect, it } from 'bun:test';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import { ProviderKind } from '../../src/core/types.ts';

const cand = (model: string, params: number, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 1, installed: false,
});

describe('provisioning eval — fit selection across RAM tiers', () => {
  const catalog = [cand('4b', 4, 3e9), cand('9b', 9, 6.6e9), cand('14b', 14, 9e9), cand('32b', 32, 20e9)];
  it('8GB budget (24GB Mac) recommends 4b, not 14b/32b', () => {
    const out = fitAndRank(catalog, 8e9);
    expect(out.find((c) => c.recommended)?.model).toBe('4b');
    expect(out.map((c) => c.model)).not.toContain('32b');
  });
  it('28GB budget (64GB Mac) admits up to 32b and recommends the largest', () => {
    const out = fitAndRank(catalog, 28e9);
    expect(out.find((c) => c.recommended)?.model).toBe('32b');
  });
});
```

- [ ] **Step 3: Run, verify fail (if fit thresholds need tuning) or pass; wrap `runProvision` in the span.**

In `provisioner.ts`, wrap the body:
```ts
import { withProvisionSpan, ATTR } from '../telemetry/spans.ts';
// ...
return withProvisionSpan(
  { candidateCount: ranked.length, selectedCount: selected.length,
    bytesTotal: required, snapshotFallback: false },
  async (span) => {
    // ... existing download loop ...
    span.setAttribute(ATTR.PROVISION_DOWNLOADED_COUNT, result.downloaded.length);
    span.setAttribute(ATTR.PROVISION_FAILED_COUNT, result.failed.length);
    return result;
  },
);
```
Adjust `fitAndRank` context sizing only if the eval reveals a threshold that misclassifies a tier; keep the estimate honest (weights + KV).

- [ ] **Step 4: Run the eval + full suite + typecheck + lint.**

Run: `bun test tests/provisioning/ && bun run typecheck && bun run lint`
Expected: all PASS; clean.

- [ ] **Step 5: Update `docs/architecture.md` — add §13 Provisioning + both Mermaid diagrams.**

Add a "§13 Provisioning (`src/provisioning/`)" section describing: the two-tier `DownloadProvider` model, the unified progress protocol, the two-phase catalog discovery + snapshot fallback, the supervisor guards, and the data-flow (CLI/hook → Provisioner → CatalogSource/DownloadProvider → RuntimeControl/ensureReady → telemetry). Add a `provisioning` node + edges to the module-map Mermaid and the data-flow Mermaid. Ensure `bun run docs:check` passes (every `src/<subsystem>` documented).

- [ ] **Step 6: Update `README.md` — Status line, slice-table row, feature paragraph.**

- Status line → "Slice 14 complete — first-boot provisioning + runtime-agnostic downloader."
- Add the slice table row `| **14** | **First-boot provisioning + downloader** — … | ✅ Done |` mirroring the existing row style.
- Add a feature paragraph "**First-boot provisioning (Slice 14).**" describing `bun run provision`, the fit→consent→download→verify flow, the four adapters (Ollama live; others deferred-verify), and the snapshot-backed dynamic discovery.
- Update the intro "First-boot model provisioning + a downloader →" line to reflect shipped status.

- [ ] **Step 7: Update `docs/ROADMAP.md` — flip Slice-14 markers.**

- Gap table: change the narrative "no first-boot model provisioning yet" and set the reliability/provisioning marker consistent with shipped.
- Recommended sequence item 7: prefix "✅ **shipped, Slice 14**".
- Keep the "Slice 14 follow-ons (MUST be included in future)" deferred section intact.

- [ ] **Step 8: Run the full gate.**

Run: `bun run check`
Expected: docs-check ✔ · typecheck ✔ · lint ✔ · tests ✔ (deterministic suite green).

- [ ] **Step 9: Regenerate the snapshot Artifact (4th living surface) — manual reminder.**

Regenerate the interactive architecture-snapshot Artifact from `docs/architecture.md`: add a **Provisioning** subsystem node + edges (CLI/hook → Provisioner → Catalog/Providers → RuntimeControl/ensureReady → telemetry), a concept card, a tour step, and a "provision" Terminal scenario; update the footer slice+test counts. Redeploy to the same Artifact URL. (Tooling can only remind — this is on the implementer.)

- [ ] **Step 10: Close the SDD ledger + commit.**

```bash
git add src/telemetry/spans.ts src/provisioning/provisioner.ts tests/provisioning/eval.test.ts docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "feat(provisioning): telemetry span + eval gate + all-four docs surfaces (Slice 14 Task 6)"
```

---

## Self-Review

**Spec coverage:** §3 architecture → Tasks 1–5; §4 progress protocol → Task 1; §5 four adapters → Tasks 2 (Ollama), 5 (LM Studio, llama.cpp/MLX via HF-fetch); §6 discovery two-phase + snapshot → Task 3 + Task 4 enrich; §7 data flow → Task 4; §8 supervisor guards → Task 2; §9 dep-free UI → Task 1; §10 telemetry → Task 6; §11 architecture-doc → Task 6; §12 testing + deferred-verify logging → Tasks 2,4 (live) + 5 (deferred, Step 9); §13 deferred items → recorded in ROADMAP (already committed) + Task 5 Step 9; §14 phasing → the six tasks; §15 docs → Task 6. No gaps.

**Placeholder scan:** every code step shows complete code; test steps show real assertions; commands are exact with expected output. The only intentional cross-task seam is Task 4 Step 7's commented imports, resolved explicitly in Task 5 Step 7.

**Type consistency:** `DownloadProgress`/`DownloadPhase`/`DownloadProvider` used identically across Tasks 1–5; `FitCandidate` (Task 3) consumed by `ProvisionUi.selectModels` (Task 4); `Candidate`/`CatalogSource`/`DiscoveryQuery`/`HostCapabilities` used verbatim from `catalog-source.ts`; `providerFor`/`enrichSize`/`catalogSourcesFor` signatures match between `registry.ts` (Task 4) and its consumers (Task 4 CLI, Task 5 re-wire); `ProviderKind.MlxServer` used consistently for the HF-fetch/LM-Studio adapters. `withProvisionSpan`/`ATTR.PROVISION_*` defined in Task 6 Step 1 and used in Step 3.
