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

