import { uncensoredEnabled } from '../policy.ts';

/**
 * Safety-checker disable is the second (orthogonal) half of the "uncensored"
 * axis — the first being model-eligibility (`isUncensoredModel`/policy.ts).
 * A safety checker only exists in the Diffusers/ComfyUI lane; mflux,
 * mlx-audio, and mlx-video are filter-free by construction and have no
 * checker to disable (see the doc comments on their strategies).
 *
 * Returns the Diffusers-lane flag fragment for the safety checker: when the
 * checker should be disabled this is `['safety_checker=None']` (the
 * Diffusers pipeline kwarg spelling); otherwise `[]` (checker stays on, no
 * flag needed). `opts.disableSafetyChecker` defaults to `uncensoredEnabled()`
 * when left unset, so uncensored-default-on flips this default-on too — this
 * is the single place that default is applied, since the ComfyUI/Diffusers
 * lane (`comfy-lane.ts`) is the only strategy a safety checker exists for.
 */
export function buildDiffusersFlags(opts: {
  disableSafetyChecker?: boolean;
}): string[] {
  const disable = opts.disableSafetyChecker ?? uncensoredEnabled();
  return disable ? ['safety_checker=None'] : [];
}
