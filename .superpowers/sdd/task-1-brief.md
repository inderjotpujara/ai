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

