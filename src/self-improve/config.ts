/** Self-improvement / continuous re-eval knobs (Slice 32). `envBool`/
 *  `envStr` siblings for this module's boolean/string knobs. Env vars are
 *  fallback-only overrides — never the source of truth.
 *
 *  `envNumber` deliberately does NOT use the legacy `Number(x) || fallback`
 *  idiom (`src/verified-build/config.ts` and friends) — that idiom silently
 *  rejects an explicit `0` (falsy) and falls back to the default, which is
 *  wrong for a knob like `AGENT_REEVAL_HYSTERESIS=0` ("demote on any
 *  confirmed regression, no noise margin"). Instead it mirrors the
 *  `Number.isFinite`-based `coerce` in `src/config/schema.ts` (~line 724):
 *  only a missing/empty/non-finite value falls back; a real `0` is honored. */

const DEFAULT_REEVAL_ENABLED = true;
const DEFAULT_SWEEP_CRON = '0 4 * * *';
const DEFAULT_HYSTERESIS = 0.15;
const DEFAULT_RERUN_CASES = 2;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Default-on convention (mirrors `telemetry/provider.ts` `recordIoEnabled` /
 *  `media/policy.ts` `uncensoredEnabled`): false only on an exact `'0'` or
 *  `'false'` (case-insensitive); anything else, including unset, is true. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !(raw === '0' || raw.toLowerCase() === 'false');
}

function envStr(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/** Master switch for the self-improvement loop (sweep + pull hook +
 *  auto-demote). `0` disables all detection + demotion; the CLI /
 *  `POST /api/evals/reeval` still work manually — a MANUAL single-artifact
 *  eval (`EvalMode.Artifact`, e.g. `bun run reeval --agent <name>` or the Ops
 *  "re-eval now" button) bypasses this switch by design and CAN still demote
 *  (see `executor.ts`'s `mode !== Artifact` check). */
export function reevalEnabled(): boolean {
  return envBool('AGENT_REEVAL_ENABLED', DEFAULT_REEVAL_ENABLED);
}

/** Cron schedule for the periodic drift sweep (the repo Cron trigger's
 *  `config.schedule`, `triggers/index.ts`). Low-traffic hour by default. */
export function reevalSweepCron(): string {
  return envStr('AGENT_REEVAL_SWEEP_CRON', DEFAULT_SWEEP_CRON);
}

/** Aggregate pass-rate drop margin a confirmed regression must EXCEED before
 *  auto-demote (D4, `regression.ts`). Guards against judge noise. */
export function reevalHysteresis(): number {
  return envNumber('AGENT_REEVAL_HYSTERESIS', DEFAULT_HYSTERESIS);
}

/** Bounded extra re-runs of each failing case; a case is confirmed-regressed
 *  only on unanimous fail across all re-runs (D4, `regression.ts`). `0` means
 *  NO confirmation pass — trust the first fail: every initially-regressed case
 *  is confirmed directly (the rerun seam is skipped), so K=0 does NOT disable
 *  demotion, it makes it maximally sensitive. */
export function reevalRerunCases(): number {
  return envNumber('AGENT_REEVAL_RERUN_CASES', DEFAULT_RERUN_CASES);
}
