import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { weightsBytes } from '../../resource/footprint.ts';
import { fitsBudget, liveBudgetBytes } from '../../resource/hardware.ts';
import { recordGenFit } from '../../telemetry/spans.ts';
import { MediaVenv } from '../cmd-resolve.ts';
import { isUncensoredModel, uncensoredEnabled } from '../policy.ts';
import { ExecMode, MediaKind } from '../types.ts';
import type { GenModelCandidate } from './catalog.ts';
import { GEN_CATALOG, GenEngine } from './catalog.ts';

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
 *  Repo `org/name` maps to `models--org--name` under the HF hub cache root —
 *  `$HF_HOME/hub` when `HF_HOME` is set (see `provisioning/dest-dir.ts` for
 *  the same env-override convention), else `~/.cache/huggingface/hub`. */
export function isGenModelInstalled(
  repo: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const dir = `models--${repo.replace(/\//g, '--')}`;
  const hubRoot = env.HF_HOME
    ? join(env.HF_HOME, 'hub')
    : join(homedir(), '.cache', 'huggingface', 'hub');
  return existsSync(join(hubRoot, dir));
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
          engine: catalog[0]?.engine ?? GenEngine.Mflux,
          venv: catalog[0]?.venv ?? MediaVenv.Media,
          execMode: catalog[0]?.execMode ?? ExecMode.OneShot,
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0 },
          label: `${pinned} (env-pinned)`,
        };
    recordGenFit({
      kind,
      chosen: pinned,
      fits: true,
      budgetBytes: 0,
      candidates: 1,
    });
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
    bytes: weightsBytes(
      c.footprint.approxParamsBillions,
      c.footprint.bytesPerWeight,
    ),
  }));
  const fitting = withBytes
    .filter((x) => fitsBudget(x.bytes, budgetBytes))
    .sort(
      (a, b) =>
        b.c.footprint.approxParamsBillions - a.c.footprint.approxParamsBillions,
    );

  // 4. Walk best→worst: installed → pick; not installed → consent → pick/skip.
  const isInstalled =
    deps.isInstalled ?? ((c) => isGenModelInstalled(c.repo, env));
  const askConsent = deps.askConsent ?? defaultAskConsent;
  for (const { c, bytes } of fitting) {
    if (await isInstalled(c)) {
      recordGenFit({
        kind,
        chosen: c.repo,
        fits: true,
        budgetBytes,
        modelBytes: bytes,
        candidates: eligible.length,
      });
      return c;
    }
    if (await askConsent(c)) {
      recordGenFit({
        kind,
        chosen: c.repo,
        fits: true,
        budgetBytes,
        modelBytes: bytes,
        candidates: eligible.length,
      });
      return c;
    }
  }

  // 5. Nothing fits/installs — degrade gracefully.
  recordGenFit({ kind, fits: false, budgetBytes, candidates: eligible.length });
  return undefined;
}
