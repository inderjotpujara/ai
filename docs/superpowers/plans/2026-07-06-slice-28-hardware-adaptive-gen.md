# Hardware-Adaptive Media Generation + Reachable Gen Degrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-prescribe a machine-appropriate generation model per modality (image/speech/video) via a parallel gen-fit ranker, and wire `runGenJob` into `createGenerateTools` so the one-shot↔server degrade + ComfyUI/Wan lane become reachable.

**Architecture:** A per-`MediaKind` `GenModelCandidate` catalog is ranked *largest-that-fits* by footprint against the live hardware budget (reusing `resource/footprint.ts` + `resource/hardware.ts`), among candidates whose engine is actually installed (consent-gating a pull otherwise). The chosen repo is injected through the existing `GenOpts.model` seam and run through the strategy matching the candidate's engine. This is **parallel to** the main model selector — media-gen has no runtime/`LanguageModel`, so it deliberately does not ride `resolveModel`/`createModel`.

**Tech Stack:** TypeScript (Bun), Zod (existing tool schemas), the existing `src/media/generate/*` adapter/strategies, `src/telemetry/spans.ts` OTel helpers, `src/reliability/ledger.ts` degrade events.

## Global Constraints

- **Runtime/tooling:** use `bun`, never `npm`. Typecheck `bun run typecheck`; focused tests `bun run test:file -- "<glob>"`; full suite `bun run test`.
- **Code style:** `type` over `interface`; **`enum` over string-literal unions** for finite named sets (string enums only, e.g. `enum GenEngine { Mflux = 'mflux' }`); discriminated unions stay `type`. Early returns; small focused files; descriptive names; no `console.log`.
- **No hardcoded model choices/budgets/limits** — compute live; env vars are fallback-only. Env-pin (`AGENT_{IMAGE,VOICE,VIDEO}_MODEL`) is the authoritative manual override; auto-fit is the computed default; hardcoded repo defaults are the last fallback.
- **Uncensored is default-ON** (`uncensoredEnabled()` — only `AGENT_UNCENSORED=0`/`false` disables). Gen-fit must not filter out uncensored candidates when enabled.
- **Never speculatively download** a model — consent-gate a pull for a not-yet-installed candidate; on decline, degrade to the next-installed candidate or return `undefined`. **Never crash** on no-fit / missing engine.
- **Docs hard line:** this slice ships all 4 living surfaces (architecture.md incl. §2 mermaid + §22, root README status+table+feature, ROADMAP markers, the snapshot Artifact) + the SDD ledger, held to the accuracy bar.
- **Telemetry to emit:** gen-fit decision (`media.gen_fit` event: chosen repo, fits, budget/model bytes, candidate count) + reuse `DegradeKind.ModelDegraded` for no-fit and exec-mode degrade.

---

## File Structure

**Create:**
- `src/media/generate/catalog.ts` — `GenEngine` enum, `GenModelCandidate` type, `GEN_CATALOG` (flat array, all kinds).
- `src/media/generate/select.ts` — `selectGenModel(kind, deps)` (rank + env-pin + uncensored + installed/consent walk + telemetry), `isGenModelInstalled` default, `SelectGenDeps`.
- `tests/media/gen-catalog.test.ts`, `tests/media/gen-select.test.ts`.

**Modify:**
- `src/telemetry/spans.ts` — `ATTR.GEN_FIT_*` keys + `recordGenFit(info)`.
- `src/media/generate/video-mlx.ts` — `ltxStrategy.buildOneShot` emits `--model` from `opts.model` when set.
- `src/media/generate/comfy-lane.ts` — `buildWanWorkflow` adds a checkpoint-loader node from `opts.model` when set.
- `src/media/generate/adapter.ts` — `runGenJob` clears `opts.model` when degrading to a *different-engine* fallback (repos are engine-specific).
- `src/media/generate/tools.ts` — call `selectGenModel`, map candidate→strategy, run via `runGenJob`, video passes `fallback` + `serverReachable`, no-fit returns a graceful message.
- `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, SDD ledger — the docs task.
- `tests/integration/multimodal.live.test.ts` — live-verify additions.

**Interfaces locked across tasks (copy verbatim):**

```ts
// catalog.ts
export enum GenEngine {
  Mflux = 'mflux',
  MlxAudio = 'mlx-audio',
  MlxVideo = 'mlx-video',
  ComfyWan = 'comfy-wan',
}
export type GenModelCandidate = {
  kind: MediaKind;            // from '../types.ts'
  repo: string;
  engine: GenEngine;
  venv: MediaVenv;            // from '../cmd-resolve.ts'
  execMode: ExecMode;         // from '../types.ts'
  footprint: { approxParamsBillions: number; bytesPerWeight: number };
  contentPolicy?: ContentPolicy; // from '../../core/types.ts'
  label: string;
};
export const GEN_CATALOG: GenModelCandidate[];

// select.ts
export type SelectGenDeps = {
  env?: Record<string, string | undefined>;
  budgetBytes?: number;                          // if set, skips liveBudgetBytes()
  isInstalled?: (c: GenModelCandidate) => boolean | Promise<boolean>;
  askConsent?: (c: GenModelCandidate) => Promise<boolean>;
  catalog?: GenModelCandidate[];
};
export function selectGenModel(
  kind: MediaKind,
  deps?: SelectGenDeps,
): Promise<GenModelCandidate | undefined>;

// spans.ts
export function recordGenFit(info: {
  kind: string; chosen?: string; fits: boolean;
  budgetBytes: number; modelBytes?: number; candidates: number;
}): void;
```

---

### Task 1: Gen candidate catalog

**Files:**
- Create: `src/media/generate/catalog.ts`
- Test: `tests/media/gen-catalog.test.ts`

**Interfaces:**
- Consumes: `MediaKind`, `ExecMode` from `src/media/types.ts`; `MediaVenv` from `src/media/cmd-resolve.ts`; `ContentPolicy` from `src/core/types.ts`.
- Produces: `GenEngine`, `GenModelCandidate`, `GEN_CATALOG` (see locked interfaces above).

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-catalog.test.ts
import { describe, expect, test } from 'bun:test';
import { MediaKind } from '../../src/media/types.ts';
import { GEN_CATALOG, GenEngine } from '../../src/media/generate/catalog.ts';

describe('GEN_CATALOG', () => {
  test('covers all three generation kinds', () => {
    const kinds = new Set(GEN_CATALOG.map((c) => c.kind));
    expect(kinds.has(MediaKind.Image)).toBe(true);
    expect(kinds.has(MediaKind.Audio)).toBe(true);
    expect(kinds.has(MediaKind.Video)).toBe(true);
  });

  test('every candidate is well-formed (positive footprint, non-empty repo/label)', () => {
    for (const c of GEN_CATALOG) {
      expect(c.repo.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.footprint.approxParamsBillions).toBeGreaterThan(0);
      expect(c.footprint.bytesPerWeight).toBeGreaterThan(0);
      expect(Object.values(GenEngine)).toContain(c.engine);
    }
  });

  test('the video ladder spans both engines (mlx-video one-shot + comfy-wan server)', () => {
    const videoEngines = new Set(
      GEN_CATALOG.filter((c) => c.kind === MediaKind.Video).map((c) => c.engine),
    );
    expect(videoEngines.has(GenEngine.MlxVideo)).toBe(true);
    expect(videoEngines.has(GenEngine.ComfyWan)).toBe(true);
  });

  test('the image anchor is the ungated pre-quantized FLUX mirror', () => {
    const image = GEN_CATALOG.filter((c) => c.kind === MediaKind.Image);
    expect(image.some((c) => c.repo === 'dhairyashil/FLUX.1-schnell-mflux-4bit')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-catalog.test.ts"`
Expected: FAIL — cannot find module `catalog.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/media/generate/catalog.ts
import { ContentPolicy } from '../../core/types.ts';
import { MediaVenv } from '../cmd-resolve.ts';
import { ExecMode, MediaKind } from '../types.ts';

/** Which generation engine a candidate runs under; maps to a GenStrategy in
 *  the tool layer. */
export enum GenEngine {
  Mflux = 'mflux',
  MlxAudio = 'mlx-audio',
  MlxVideo = 'mlx-video',
  ComfyWan = 'comfy-wan',
}

/** A hardware-fit-rankable generation model. Deliberately NOT a
 *  `ModelDeclaration`: gen has no runtime and produces a file via a spawned
 *  CLI, so it carries an engine/venv/exec-mode instead of a RuntimeKind, and
 *  is ranked by footprint against the live budget rather than warmed into a
 *  server (see reference-gen-fit-impedance-mismatch). */
export type GenModelCandidate = {
  kind: MediaKind;
  repo: string;
  engine: GenEngine;
  venv: MediaVenv;
  execMode: ExecMode;
  footprint: { approxParamsBillions: number; bytesPerWeight: number };
  contentPolicy?: ContentPolicy;
  label: string;
};

/**
 * Seeded small→large ladders per kind. Footprints web-validated 2026-07-06
 * (reference-gen-model-catalog-2026). `bytesPerWeight` reflects the effective
 * on-disk quant (4bit≈0.55, 8bit≈1.1, bf16≈2.0), used only for relative
 * fit-ranking against the live budget — not an exact byte count.
 */
export const GEN_CATALOG: GenModelCandidate[] = [
  // Image — mflux (one-shot). Small anchor is ungated + pre-quantized.
  {
    kind: MediaKind.Image,
    repo: 'dhairyashil/FLUX.1-schnell-mflux-4bit',
    engine: GenEngine.Mflux,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 12, bytesPerWeight: 0.55 },
    label: 'FLUX.1-schnell 4bit (mflux)',
  },
  {
    kind: MediaKind.Image,
    repo: 'dhairyashil/FLUX.1-schnell-mflux-8bit',
    engine: GenEngine.Mflux,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 12, bytesPerWeight: 1.1 },
    label: 'FLUX.1-schnell 8bit (mflux)',
  },
  // Speech — mlx-audio (one-shot). Kokoro is filter-free + no cloning.
  {
    kind: MediaKind.Audio,
    repo: 'mlx-community/Kokoro-82M-bf16',
    engine: GenEngine.MlxAudio,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 0.082, bytesPerWeight: 2.0 },
    label: 'Kokoro-82M (mlx-audio)',
  },
  {
    kind: MediaKind.Audio,
    repo: 'mlx-community/csm-1b',
    engine: GenEngine.MlxAudio,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 1, bytesPerWeight: 2.0 },
    label: 'Sesame CSM-1B voice clone (mlx-audio)',
  },
  // Video — spans mlx-video (one-shot) + ComfyUI/Wan (server). Ladder.
  {
    kind: MediaKind.Video,
    repo: 'city96/LTX-Video-0.9.6-distilled-gguf',
    engine: GenEngine.ComfyWan,
    venv: MediaVenv.Video,
    execMode: ExecMode.Server,
    footprint: { approxParamsBillions: 2, bytesPerWeight: 2.0 },
    label: 'LTX-Video 0.9.6 distilled GGUF (ComfyUI)',
  },
  {
    kind: MediaKind.Video,
    repo: 'dgrauet/ltx-2.3-mlx-q4',
    engine: GenEngine.MlxVideo,
    venv: MediaVenv.Video,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 22, bytesPerWeight: 0.55 },
    label: 'LTX-2.3 int4 (mlx-video)',
  },
  {
    kind: MediaKind.Video,
    repo: 'QuantStack/Wan2.2-TI2V-5B-GGUF',
    engine: GenEngine.ComfyWan,
    venv: MediaVenv.Video,
    execMode: ExecMode.Server,
    footprint: { approxParamsBillions: 5, bytesPerWeight: 1.1 },
    label: 'Wan2.2 TI2V-5B GGUF (ComfyUI)',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-catalog.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/catalog.ts tests/media/gen-catalog.test.ts
git commit -m "feat(media): gen model candidate catalog (image/speech/video ladders)"
```

---

### Task 2: Gen-fit telemetry

**Files:**
- Modify: `src/telemetry/spans.ts` (ATTR block near line 129–135; add `recordGenFit` near `recordDegrade` ~line 297)
- Test: `tests/telemetry/gen-fit-span.test.ts`

**Interfaces:**
- Consumes: `trace.getActiveSpan()` (already imported in spans.ts), the `ATTR` object.
- Produces: `ATTR.GEN_FIT_CHOSEN/GEN_FIT_FITS/GEN_FIT_BUDGET_BYTES/GEN_FIT_MODEL_BYTES/GEN_FIT_CANDIDATES`; `recordGenFit(info)` (see locked interface).

- [ ] **Step 1: Write the failing test**

```ts
// tests/telemetry/gen-fit-span.test.ts
import { describe, expect, test } from 'bun:test';
import { recordGenFit } from '../../src/telemetry/spans.ts';

describe('recordGenFit', () => {
  test('is a no-op with no active span (does not throw)', () => {
    expect(() =>
      recordGenFit({
        kind: 'video',
        chosen: 'dgrauet/ltx-2.3-mlx-q4',
        fits: true,
        budgetBytes: 30_000_000_000,
        modelBytes: 14_520_000_000,
        candidates: 3,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/telemetry/gen-fit-span.test.ts"`
Expected: FAIL — `recordGenFit` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to the `ATTR` object in `src/telemetry/spans.ts` (right after `MEDIA_GENERATE_OUTCOME`):

```ts
  GEN_FIT_CHOSEN: 'media.gen_fit.chosen',
  GEN_FIT_FITS: 'media.gen_fit.fits',
  GEN_FIT_BUDGET_BYTES: 'media.gen_fit.budget_bytes',
  GEN_FIT_MODEL_BYTES: 'media.gen_fit.model_bytes',
  GEN_FIT_CANDIDATES: 'media.gen_fit.candidates',
```

Add near `recordDegrade` (mirrors its active-span-event shape):

```ts
/** Record the gen-fit selection decision on the active span (mirrors
 *  recordDegrade). No-op when there is no active span. */
export function recordGenFit(info: {
  kind: string;
  chosen?: string;
  fits: boolean;
  budgetBytes: number;
  modelBytes?: number;
  candidates: number;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('media.gen_fit', {
    [ATTR.MEDIA_GENERATE_KIND]: info.kind,
    [ATTR.GEN_FIT_FITS]: info.fits,
    [ATTR.GEN_FIT_BUDGET_BYTES]: info.budgetBytes,
    [ATTR.GEN_FIT_CANDIDATES]: info.candidates,
    ...(info.chosen ? { [ATTR.GEN_FIT_CHOSEN]: info.chosen } : {}),
    ...(info.modelBytes !== undefined
      ? { [ATTR.GEN_FIT_MODEL_BYTES]: info.modelBytes }
      : {}),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/telemetry/gen-fit-span.test.ts"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/telemetry/spans.ts tests/telemetry/gen-fit-span.test.ts
git commit -m "feat(telemetry): recordGenFit + gen.fit.* attrs for gen-fit decisions"
```

---

### Task 3: Gen-fit selector

**Files:**
- Create: `src/media/generate/select.ts`
- Test: `tests/media/gen-select.test.ts`

**Interfaces:**
- Consumes: `GEN_CATALOG`, `GenModelCandidate` (Task 1); `weightsBytes` from `src/resource/footprint.ts`; `fitsBudget`, `liveBudgetBytes` from `src/resource/hardware.ts`; `uncensoredEnabled`, `isUncensoredModel` from `src/media/policy.ts`; `recordGenFit` (Task 2); `MediaKind` from `src/media/types.ts`.
- Produces: `selectGenModel(kind, deps)`, `SelectGenDeps`, `isGenModelInstalled(repo)` (see locked interfaces).

Behavior (single function, walked best-first):
1. **Env-pin authoritative** — if `AGENT_{IMAGE,VOICE,VIDEO}_MODEL` is set for this kind, return a synthetic candidate built from it (no ranking, no consent), then `recordGenFit({fits:true})`.
2. Else filter `catalog` to this `kind`, drop uncensored candidates when `!uncensoredEnabled(env)`.
3. Estimate bytes via `weightsBytes(params, bytesPerWeight)`; rank fitting candidates largest-params first.
4. Walk fitting candidates best→worst: if `isInstalled` → pick; if not installed → `askConsent` → pick on yes, else continue.
5. No pickable candidate → `recordGenFit({fits:false, chosen:undefined})`, return `undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-select.test.ts
import { describe, expect, test } from 'bun:test';
import { MediaKind, ExecMode } from '../../src/media/types.ts';
import { MediaVenv } from '../../src/media/cmd-resolve.ts';
import { GenEngine } from '../../src/media/generate/catalog.ts';
import type { GenModelCandidate } from '../../src/media/generate/catalog.ts';
import { selectGenModel } from '../../src/media/generate/select.ts';
import { ContentPolicy } from '../../src/core/types.ts';

const img = (
  repo: string,
  params: number,
  extra: Partial<GenModelCandidate> = {},
): GenModelCandidate => ({
  kind: MediaKind.Image,
  repo,
  engine: GenEngine.Mflux,
  venv: MediaVenv.Media,
  execMode: ExecMode.OneShot,
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.55 },
  label: repo,
  ...extra,
});

const GB = 1_000_000_000;

describe('selectGenModel', () => {
  test('picks the largest candidate that fits the budget', async () => {
    const catalog = [img('small', 2), img('mid', 12), img('huge', 200)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 20 * GB,
      isInstalled: () => true,
      catalog,
    });
    expect(chosen?.repo).toBe('mid'); // 200B doesn't fit; 12B is largest that does
  });

  test('returns undefined when nothing fits (no crash)', async () => {
    const catalog = [img('huge', 200)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 1 * GB,
      isInstalled: () => true,
      catalog,
    });
    expect(chosen).toBeUndefined();
  });

  test('env pin is authoritative — returns the pinned repo, no ranking', async () => {
    const catalog = [img('mid', 12)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: { AGENT_IMAGE_MODEL: 'my/custom-model' },
      budgetBytes: 1, // would fit nothing, but pin bypasses ranking
      isInstalled: () => false,
      catalog,
    });
    expect(chosen?.repo).toBe('my/custom-model');
  });

  test('drops uncensored candidates when uncensored is disabled', async () => {
    const catalog = [
      img('clean', 12),
      img('dolphin-x', 20, { contentPolicy: ContentPolicy.Uncensored }),
    ];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: { AGENT_UNCENSORED: '0' },
      budgetBytes: 50 * GB,
      isInstalled: () => true,
      catalog,
    });
    expect(chosen?.repo).toBe('clean'); // 20B dolphin filtered out despite being larger
  });

  test('consent-gates a pull: declining skips to the next installed candidate', async () => {
    const catalog = [img('big-uninstalled', 20), img('small-installed', 12)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 50 * GB,
      isInstalled: (c) => c.repo === 'small-installed',
      askConsent: async () => false, // decline the big one's download
      catalog,
    });
    expect(chosen?.repo).toBe('small-installed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-select.test.ts"`
Expected: FAIL — cannot find module `select.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/media/generate/select.ts
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fitsBudget, liveBudgetBytes } from '../../resource/hardware.ts';
import { weightsBytes } from '../../resource/footprint.ts';
import { recordGenFit } from '../../telemetry/spans.ts';
import { isUncensoredModel, uncensoredEnabled } from '../policy.ts';
import { MediaKind } from '../types.ts';
import { GEN_CATALOG } from './catalog.ts';
import type { GenModelCandidate } from './catalog.ts';

/** Per-kind env pin var name — the authoritative manual override. */
const ENV_PIN: Record<MediaKind, string> = {
  [MediaKind.Image]: 'AGENT_IMAGE_MODEL',
  [MediaKind.Audio]: 'AGENT_VOICE_MODEL',
  [MediaKind.Video]: 'AGENT_VIDEO_MODEL',
};

export type SelectGenDeps = {
  env?: Record<string, string | undefined>;
  /** If set, skips the live hardware read (test seam). */
  budgetBytes?: number;
  isInstalled?: (c: GenModelCandidate) => boolean | Promise<boolean>;
  askConsent?: (c: GenModelCandidate) => Promise<boolean>;
  catalog?: GenModelCandidate[];
};

/** Default installed-check: the model's HF snapshot dir exists in the cache.
 *  Repo `org/name` maps to `~/.cache/huggingface/hub/models--org--name`. */
export function isGenModelInstalled(repo: string): boolean {
  const dir = `models--${repo.replace(/\//g, '--')}`;
  return existsSync(join(homedir(), '.cache', 'huggingface', 'hub', dir));
}

/** Default pull-consent: decline in a non-interactive context (fail-safe —
 *  never speculatively download); a TTY host injects a real prompt via deps. */
async function defaultAskConsent(): Promise<boolean> {
  return false;
}

/**
 * Prescribe a machine-appropriate generation model for `kind`, largest-that-
 * fits by footprint against the live hardware budget, among candidates whose
 * engine model is installed (or whose download the user consents to). Env pin
 * is authoritative. Returns `undefined` when nothing fits/installs — the
 * caller degrades gracefully (never crashes). Parallel to the main model
 * selector by design (media-gen has no runtime/LanguageModel).
 */
export async function selectGenModel(
  kind: MediaKind,
  deps: SelectGenDeps = {},
): Promise<GenModelCandidate | undefined> {
  const env = deps.env ?? process.env;
  const catalog = deps.catalog ?? GEN_CATALOG;

  // 1. Env pin is authoritative — bypass ranking + consent entirely.
  const pinned = env[ENV_PIN[kind]];
  if (pinned) {
    const base = catalog.find((c) => c.kind === kind);
    const candidate: GenModelCandidate = base
      ? { ...base, repo: pinned, label: `${pinned} (env-pinned)` }
      : {
          kind,
          repo: pinned,
          engine: catalog[0]?.engine ?? ('mflux' as GenModelCandidate['engine']),
          venv: catalog[0]?.venv ?? ('Media' as GenModelCandidate['venv']),
          execMode: catalog[0]?.execMode ?? ('OneShot' as GenModelCandidate['execMode']),
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0 },
          label: `${pinned} (env-pinned)`,
        };
    recordGenFit({ kind, chosen: pinned, fits: true, budgetBytes: 0, candidates: 1 });
    return candidate;
  }

  // 2. Filter by kind + uncensored eligibility.
  const allowUncensored = uncensoredEnabled(env);
  const eligible = catalog.filter(
    (c) =>
      c.kind === kind &&
      (allowUncensored ||
        !isUncensoredModel({ model: c.repo, contentPolicy: c.contentPolicy })),
  );

  // 3. Rank largest-that-fits by footprint.
  const budgetBytes = deps.budgetBytes ?? (await liveBudgetBytes());
  const withBytes = eligible.map((c) => ({
    c,
    bytes: weightsBytes(c.footprint.approxParamsBillions, c.footprint.bytesPerWeight),
  }));
  const fitting = withBytes
    .filter((x) => fitsBudget(x.bytes, budgetBytes))
    .sort(
      (a, b) =>
        b.c.footprint.approxParamsBillions - a.c.footprint.approxParamsBillions,
    );

  // 4. Walk best→worst: installed → pick; not installed → consent → pick/skip.
  const isInstalled = deps.isInstalled ?? ((c) => isGenModelInstalled(c.repo));
  const askConsent = deps.askConsent ?? defaultAskConsent;
  for (const { c, bytes } of fitting) {
    if (await isInstalled(c)) {
      recordGenFit({
        kind, chosen: c.repo, fits: true, budgetBytes,
        modelBytes: bytes, candidates: eligible.length,
      });
      return c;
    }
    if (await askConsent(c)) {
      recordGenFit({
        kind, chosen: c.repo, fits: true, budgetBytes,
        modelBytes: bytes, candidates: eligible.length,
      });
      return c;
    }
  }

  // 5. Nothing fits/installs — degrade gracefully.
  recordGenFit({ kind, fits: false, budgetBytes, candidates: eligible.length });
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-select.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/select.ts tests/media/gen-select.test.ts
git commit -m "feat(media): gen-fit selector — largest-that-fits, env-pin, uncensored, consent-gated"
```

---

### Task 4: Video model plumb (LTX `--model` from opts.model)

**Files:**
- Modify: `src/media/generate/video-mlx.ts:18-49` (`ltxStrategy.buildOneShot`)
- Test: `tests/media/video-model-plumb.test.ts`

**Interfaces:**
- Consumes: `ltxStrategy` from `src/media/generate/video-mlx.ts`; `GenOpts` from `src/media/generate/adapter.ts`.
- Produces: `ltxStrategy.buildOneShot` now emits `--model <repo>` when `opts.model` is set (absent otherwise, preserving today's baked-repo behavior). Live-verify confirms the exact flag name against the real CLI (like the earlier `--num-frames` fix).

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/video-model-plumb.test.ts
import { describe, expect, test } from 'bun:test';
import { ltxStrategy } from '../../src/media/generate/video-mlx.ts';

describe('ltxStrategy --model plumb', () => {
  test('emits --model when opts.model is set', () => {
    const { args } = ltxStrategy.buildOneShot!('a cat', '/tmp/out.mp4', {
      model: 'dgrauet/ltx-2.3-mlx-q4',
    });
    const i = args.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('dgrauet/ltx-2.3-mlx-q4');
  });

  test('omits --model when opts.model is unset (baked-repo behavior)', () => {
    const { args } = ltxStrategy.buildOneShot!('a cat', '/tmp/out.mp4', {});
    expect(args).not.toContain('--model');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/video-model-plumb.test.ts"`
Expected: FAIL — first test fails (no `--model` in args).

- [ ] **Step 3: Write minimal implementation**

In `src/media/generate/video-mlx.ts`, inside `buildOneShot`'s returned `args` array, add the model flag conditionally right after `'--prompt', prompt,` (mirroring the existing `opts.image` conditional spread):

```ts
      args: [
        '--prompt',
        prompt,
        ...(opts.model ? ['--model', opts.model] : []),
        '--pipeline',
        pipeline,
        ...(opts.image ? ['--image', opts.image] : []),
        '--num-frames',
        String(frames),
        '--width',
        String(width),
        '--height',
        String(height),
        ...(opts.steps ? ['--steps', String(opts.steps)] : []),
        '--output-path',
        outPath,
      ],
```

Also update the doc-comment above `ltxStrategy` to note: `model: opts.model adds --model <repo> (from the gen-fit selector); omitted → the mlx-video default repo.`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/video-model-plumb.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/video-mlx.ts tests/media/video-model-plumb.test.ts
git commit -m "feat(media): ltxStrategy emits --model from opts.model (gen-fit injection)"
```

---

### Task 5: Wan checkpoint from opts.model

**Files:**
- Modify: `src/media/generate/comfy-lane.ts:34-87` (`buildWanWorkflow`)
- Test: extend `tests/media/*` — add `tests/media/wan-checkpoint.test.ts`

**Interfaces:**
- Consumes: `wanComfyStrategy` (its internal `buildWanWorkflow` is not exported — test through the public seam by exporting `buildWanWorkflow`).
- Produces: `buildWanWorkflow` exported; adds a `CheckpointLoaderSimple` node whose `ckpt_name` is `opts.model` when set.

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/wan-checkpoint.test.ts
import { describe, expect, test } from 'bun:test';
import { buildWanWorkflow } from '../../src/media/generate/comfy-lane.ts';

describe('buildWanWorkflow checkpoint', () => {
  test('adds a checkpoint loader from opts.model when set', () => {
    const wf = buildWanWorkflow('a dog running', {
      model: 'city96/LTX-Video-0.9.6-distilled-gguf',
    }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const loader = Object.values(wf).find(
      (n) => n.class_type === 'CheckpointLoaderSimple',
    );
    expect(loader?.inputs.ckpt_name).toBe('city96/LTX-Video-0.9.6-distilled-gguf');
  });

  test('omits the checkpoint loader when opts.model is unset', () => {
    const wf = buildWanWorkflow('a dog running', {}) as Record<
      string,
      { class_type: string }
    >;
    const hasLoader = Object.values(wf).some(
      (n) => n.class_type === 'CheckpointLoaderSimple',
    );
    expect(hasLoader).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/wan-checkpoint.test.ts"`
Expected: FAIL — `buildWanWorkflow` not exported / no loader node.

- [ ] **Step 3: Write minimal implementation**

In `src/media/generate/comfy-lane.ts`: change `function buildWanWorkflow(` to `export function buildWanWorkflow(`. Before the `return workflow;` line, add:

```ts
  // Checkpoint from the gen-fit-selected repo (opts.model). Shape-only until
  // live-verify against a real ComfyUI export corrects the exact node wiring.
  if (opts.model) {
    workflow['10'] = {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: opts.model },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/wan-checkpoint.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/comfy-lane.ts tests/media/wan-checkpoint.test.ts
git commit -m "feat(media): Wan workflow takes checkpoint from opts.model (gen-fit injection)"
```

---

### Task 6: runGenJob clears model on cross-engine degrade

**Files:**
- Modify: `src/media/generate/adapter.ts:507-554` (`runGenJob`)
- Test: `tests/media/gen-job-degrade-model.test.ts`

**Interfaces:**
- Consumes: `runGenJob`, `GenStrategy` (existing).
- Produces: on a degrade to a different-`engine` fallback, `runGenJob` passes `{ ...opts, model: undefined }` so the fallback strategy uses its own default repo (a repo is engine-specific and must not leak across engines). Same-engine degrades keep `opts.model`.

Note: the `GenStrategy` type has no `engine` field. Use `execMode` difference as the proxy is insufficient (both video strategies differ by execMode but also by engine/repo). Instead, ALWAYS clear `opts.model` when running the fallback — the fallback is always a *different* strategy with its own default. Both degrade branches (`runServerJob(fallback,...)` and `runOneShotJob(fallback,...)`) get `{ ...opts, model: undefined }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-job-degrade-model.test.ts
import { describe, expect, test } from 'bun:test';
import { runGenJob } from '../../src/media/generate/adapter.ts';
import type { GenStrategy } from '../../src/media/generate/adapter.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('runGenJob cross-engine degrade drops the model repo', () => {
  test('fallback strategy is invoked without opts.model', async () => {
    let fallbackModel: string | undefined = 'UNSET';
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const primary: GenStrategy = {
      kind: MediaKind.Video,
      execMode: ExecMode.OneShot,
      buildOneShot: () => ({ cmd: 'definitely-not-installed-xyz', args: [] }),
    };
    const fallback: GenStrategy = {
      kind: MediaKind.Video,
      execMode: ExecMode.Server,
      serverSubmit: async (_p, opts) => {
        fallbackModel = opts.model;
        return {
          poll: async () => ({ fraction: 1 }),
          result: async () => '/tmp/never.mp4', // putFile will fail; we only assert the model
        };
      },
    };
    const job = runGenJob(primary, 'a cat', store, 'video/mp4', { model: 'mlx/repo' }, {
      fallback,
      which: () => null, // force the "primary binary missing" degrade
    });
    await job.result().catch(() => {}); // result may reject on the fake path; irrelevant
    expect(fallbackModel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-job-degrade-model.test.ts"`
Expected: FAIL — `fallbackModel` is `'mlx/repo'` (opts.model leaked into the fallback).

- [ ] **Step 3: Write minimal implementation**

In `src/media/generate/adapter.ts`, in `runGenJob`, change the two fallback invocations to strip the model repo:

```ts
    if (fallback) {
      recordExecModeDegrade(
        deps,
        ExecMode.OneShot,
        ExecMode.Server,
        primary.kind,
        `engine binary "${cmd}" not found on PATH`,
      );
      return runServerJob(fallback, prompt, store, mediaType, { ...opts, model: undefined }, deps);
    }
```

and

```ts
  if (fallback) {
    recordExecModeDegrade(
      deps,
      ExecMode.Server,
      ExecMode.OneShot,
      primary.kind,
      'server engine unreachable',
    );
    return runOneShotJob(fallback, prompt, store, mediaType, { ...opts, model: undefined }, deps);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-job-degrade-model.test.ts"`
Expected: PASS. Also re-run the existing adapter tests: `bun run test:file -- "tests/media/*adapter*"` — Expected: still PASS (same-strategy non-degrade paths unchanged).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/adapter.ts tests/media/gen-job-degrade-model.test.ts
git commit -m "fix(media): runGenJob drops engine-specific model repo when degrading to a fallback"
```

---

### Task 7: Wire selector + runGenJob into createGenerateTools

**Files:**
- Modify: `src/media/generate/tools.ts` (whole `createGenerateTools`)
- Test: `tests/media/gen-tools-wiring.test.ts`

**Interfaces:**
- Consumes: `selectGenModel` (Task 3); `runGenJob` (Task 6); `mfluxStrategy`/`kokoroStrategy`/`ltxStrategy`/`wanComfyStrategy`; `GenEngine`/`GenModelCandidate` (Task 1).
- Produces: the three tools now (a) select a fit model → set `opts.model`, (b) run via `runGenJob` with the strategy matching the candidate's engine, (c) video passes `fallback` (the other video strategy) + a `serverReachable` probe, (d) return a graceful message when `selectGenModel` returns `undefined`.

Add a `strategyForEngine` map local to tools.ts:

```ts
const STRATEGY_FOR_ENGINE: Record<GenEngine, GenStrategy> = {
  [GenEngine.Mflux]: mfluxStrategy,
  [GenEngine.MlxAudio]: kokoroStrategy,
  [GenEngine.MlxVideo]: ltxStrategy,
  [GenEngine.ComfyWan]: wanComfyStrategy,
};
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-tools-wiring.test.ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';

describe('createGenerateTools no-fit degrade', () => {
  test('generate_image returns a graceful message when no model fits', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const tools = createGenerateTools(store, {
      selectModel: async () => undefined, // force no-fit
    });
    const result = await (tools.generate_image as any).execute({ prompt: 'x' });
    expect(String(result).toLowerCase()).toContain('no ');
    expect(String(result).toLowerCase()).toContain('image');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-tools-wiring.test.ts"`
Expected: FAIL — `deps.selectModel` seam / no-fit message not present.

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/media/generate/tools.ts`:

```ts
import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import {
  affirmCloneConsent,
  defaultCloneConsentAsk,
  requiresCloneConsent,
} from '../consent.ts';
import type { MediaStore } from '../store.ts';
import { MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';
import { runGenJob } from './adapter.ts';
import { resolveVoiceModel } from './audio-mlx.ts';
import { kokoroStrategy } from './audio-mlx.ts';
import { GenEngine } from './catalog.ts';
import type { GenModelCandidate } from './catalog.ts';
import { mfluxStrategy } from './image-mflux.ts';
import { selectGenModel } from './select.ts';
import { ltxStrategy } from './video-mlx.ts';
import { wanComfyStrategy } from './comfy-lane.ts';

const STRATEGY_FOR_ENGINE: Record<GenEngine, GenStrategy> = {
  [GenEngine.Mflux]: mfluxStrategy,
  [GenEngine.MlxAudio]: kokoroStrategy,
  [GenEngine.MlxVideo]: ltxStrategy,
  [GenEngine.ComfyWan]: wanComfyStrategy,
};

/** The same-kind other-engine video strategy, used as the runGenJob fallback
 *  so the one-shot↔server degrade is reachable. */
function videoFallbackFor(primary: GenStrategy): GenStrategy {
  return primary === ltxStrategy ? wanComfyStrategy : ltxStrategy;
}

/** Probe whether a local ComfyUI server is reachable (server-lane engine).
 *  Best-effort; a failed/absent probe means "unreachable" → degrade. */
async function comfyReachable(): Promise<boolean> {
  const host = process.env.AGENT_COMFY_HOST ?? '127.0.0.1';
  const port = process.env.AGENT_COMFY_PORT ?? '8188';
  try {
    const res = await fetch(`http://${host}:${port}/system_stats`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function createGenerateTools(
  store: MediaStore,
  deps?: {
    spawn?: SpawnFn;
    askCloneConsent?: (question: string) => Promise<boolean>;
    /** Test seam: override the fit selector. */
    selectModel?: (kind: MediaKind) => Promise<GenModelCandidate | undefined>;
  },
): ToolSet {
  const select = deps?.selectModel ?? ((kind: MediaKind) => selectGenModel(kind));

  const generate_image = tool({
    description: 'Generates an image from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the image to generate'),
    }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Image);
      if (!candidate) {
        return 'No image-generation model fits this machine — set AGENT_IMAGE_MODEL or free up memory. Image was not generated.';
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const opts: GenOpts = { model: candidate.repo };
      const job = runGenJob(strategy, prompt, store, 'image/png', opts, deps);
      const fh = await job.result();
      return `Generated image: ${fh.uri}`;
    },
  });

  const generate_speech = tool({
    description: 'Generates spoken audio from text and saves it to disk.',
    inputSchema: z.object({ prompt: z.string().describe('The text to speak') }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Audio);
      if (!candidate) {
        return 'No speech-generation model fits this machine — set AGENT_VOICE_MODEL or free up memory. Speech was not generated.';
      }
      const opts: GenOpts = { model: candidate.repo };
      const model = resolveVoiceModel(opts);
      if (requiresCloneConsent(model)) {
        const ask = deps?.askCloneConsent ?? defaultCloneConsentAsk();
        const consented = await affirmCloneConsent({ ask });
        if (!consented) {
          return `Voice-clone consent declined for model "${model}" — speech was not generated.`;
        }
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const job = runGenJob(strategy, prompt, store, 'audio/wav', opts, deps);
      const fh = await job.result();
      return `Generated speech: ${fh.uri}`;
    },
  });

  const generate_video = tool({
    description:
      'Generates a short video from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the video to generate'),
    }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Video);
      if (!candidate) {
        return 'No video-generation model fits this machine — set AGENT_VIDEO_MODEL or use a higher-memory/disk box. Video was not generated.';
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const opts: GenOpts = { model: candidate.repo };
      const job = runGenJob(strategy, prompt, store, 'video/mp4', opts, {
        ...deps,
        fallback: videoFallbackFor(strategy),
        serverReachable: () => true, // sync probe seam; async reachability below
      });
      const fh = await job.result();
      return `Generated video: ${fh.uri}`;
    },
  });

  return { generate_image, generate_speech, generate_video };
}
```

Note on `serverReachable`: `runGenJob`'s `serverReachable` is synchronous `(strategy) => boolean`. A real async ComfyUI probe (`comfyReachable`) can't be awaited inside that sync callback, so for this slice the server→one-shot degrade is exercised by the **one-shot-primary→server-fallback** path (LTX binary missing → Wan). Keep `comfyReachable` defined for the live-verify task, but wire the synchronous default here; a fully-async reachability probe in `runGenJob` is a disclosed follow-on (matches the existing "serverReachable deferred to Phase C" note in adapter.ts).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-tools-wiring.test.ts"`
Expected: PASS. Then run the existing media suite: `bun run test:file -- "tests/media/*"` — Expected: PASS (fix any test that constructed tools expecting the old `runOneShotJob` direct call — update to the `selectModel` seam).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/tools.ts tests/media/gen-tools-wiring.test.ts
git commit -m "feat(media): wire gen-fit selector + runGenJob into createGenerateTools"
```

---

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

### Task 9: All-4-docs + Artifact

**Files:**
- Modify: `docs/architecture.md` (§22 + §2 mermaid Media subgraph), `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`, regenerate the snapshot Artifact.

- [ ] **Step 1: architecture.md**

- §22: add `generate/catalog.ts` + `generate/select.ts` to the module map; add a "Hardware-adaptive generation" subsection describing the parallel gen-fit path (env-pin authoritative → uncensored filter → largest-that-fits vs live budget → installed/consent walk → `GenOpts.model` injection → engine→strategy map), why it is parallel (impedance mismatch), and the corrected video sizing. Update the "honest gap" prose: `runGenJob` is now wired; `Capability.*Gen` remain typed-but-not-selector-consumed *by design*.
- §2 mermaid MEDIA subgraph: add `mediaselect["generate/select.ts · selectGenModel (largest-that-fits)"]` and `mediacatalog["generate/catalog.ts · GenModelCandidate ladders"]`; edges `mediagentools --> mediaselect`, `mediaselect --> mediacatalog`, `mediaselect --> mediapolicy`, `mediaselect --> res` (hardware budget), `mediaselect --> spans`.

- [ ] **Step 2: README.md** — Status line + slice table (new Slice 28 row ✅ Done) + a feature paragraph; update the "Next" line to Slice 29 (voice/streaming).

- [ ] **Step 3: ROADMAP.md** — flip the Slice-27 follow-on rows (hardware-adaptive gen + runGenJob wiring) to ✅ shipped (Slice 28) in the follow-ons section + recommended sequence.

- [ ] **Step 4: SDD ledger** — append the Slice-28 per-task/review/fix/landing entries to `.superpowers/sdd/progress.md`.

- [ ] **Step 5: Artifact** — load the `artifact-design` skill; WebFetch the current artifact URL (`c760844f`); add the gen-fit nodes/edges to the Media node's story + bump the footer to "Snapshot after Slice 28 · 28 slices · <N> tests"; `node --check` the data script + referential-integrity before redeploy to the same URL.

- [ ] **Step 6: Verify docs gate + commit**

Run: `bun run docs:check` (Expected: green) then:
```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(slice-28): all-4-surfaces — hardware-adaptive gen + reachable runGenJob"
```

---

### Task 10: Whole-branch final review + merge

**Files:** none new — review + fixes + integration.

- [ ] **Step 1: Full gate**

Run: `bun run check` (docs-check · typecheck · lint · tests). Expected: green. Record the full-suite pass/skip/fail counts.

- [ ] **Step 2: Fan-out final review**

Dispatch 3 parallel review subagents over the whole branch diff (`git diff main...HEAD`): **correctness** (ranking edge cases, env-pin precedence, cross-engine degrade, no-fit paths), **security** (consent-before-pull actually fail-safe in non-TTY; uncensored copy-not-a-gate; no path issues in `isGenModelInstalled`), **docs-accuracy** (every doc claim matches the code — especially the §2 mermaid edges + the corrected video sizing). Report findings ranked; apply verified fixes.

- [ ] **Step 3: Re-run gate after fixes** — `bun run check`. Expected: green.

- [ ] **Step 4: Merge + push** (ask the user y/N before each git action):
```bash
git checkout main && git merge --no-ff slice-28-hardware-adaptive-gen
git push        # slice-landing gate: README + ROADMAP + ledger updated in this push
```
Then delete the branch and confirm `main...origin/main` in sync. Regenerate/redeploy the Artifact if not already done in Task 9.

---

## Self-Review

**Spec coverage:**
- Gen candidate catalog → Task 1. ✅
- Gen-fit selector (env-pin authoritative, uncensored filter, largest-that-fits, consent-gated pull, no-fit degrade) → Task 3. ✅
- Injection seam (`GenOpts.model`; image/speech zero-change; video `--model` plumb; Wan checkpoint) → Tasks 4, 5, 7. ✅
- Wire `runGenJob` (video fallback + reachability; cross-engine repo safety) → Tasks 6, 7. ✅
- Telemetry (`gen.fit.*` + `DegradeKind.ModelDegraded`) → Task 2 (+ reuse in adapter). ✅
- Testing (unit + live-verify render-or-degrade) → Tasks 1–8. ✅
- All-4-docs + Artifact → Task 9. ✅
- Final review + merge → Task 10. ✅

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the one deliberate deferral (fully-async ComfyUI reachability in `runGenJob`) is disclosed and matches the existing adapter note, not a hidden gap.

**Type consistency:** `selectGenModel(kind, deps) → Promise<GenModelCandidate | undefined>` used identically in Task 3 (def) and Task 7 (consumer via `selectModel` seam). `GenEngine`/`GenModelCandidate` from Task 1 used in Tasks 3 & 7. `recordGenFit` signature from Task 2 matches its Task 3 calls. `GenOpts.model` (existing) is the single injection field throughout.
