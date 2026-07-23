/** Self-improvement / continuous re-eval knobs (Slice 32). Mirrors the
 *  `envNumber` idiom in `src/verified-build/config.ts`, plus an `envBool`/
 *  `envStr` sibling for this module's boolean/string knobs. Env vars are
 *  fallback-only overrides — never the source of truth. */

const DEFAULT_REEVAL_ENABLED = true;
const DEFAULT_SWEEP_CRON = '0 4 * * *';
const DEFAULT_HYSTERESIS = 0.15;
const DEFAULT_RERUN_CASES = 2;

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
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
 *  `POST /api/evals/reeval` still work manually. */
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
 *  only on unanimous fail across all re-runs (D4, `regression.ts`). */
export function reevalRerunCases(): number {
  return envNumber('AGENT_REEVAL_RERUN_CASES', DEFAULT_RERUN_CASES);
}
