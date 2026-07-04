const DEFAULT_DRY_RUN_MS = 45000;
const DEFAULT_MAX_REPAIRS = 2;
const DEFAULT_REUSE_BAND = 0.85;
const DEFAULT_OFFER_BAND = 0.75;
const DEFAULT_JUDGE_MIN_PARAMS = 24e9;
const DEFAULT_ARCHIVE_IDLE_DAYS = 30;
const DEFAULT_EVAL_RUNS = 3;

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
}

export function dryRunMs(): number {
  return envNumber('AGENT_DRY_RUN_MS', DEFAULT_DRY_RUN_MS);
}

export function maxRepairs(): number {
  return envNumber('AGENT_BUILD_MAX_REPAIRS', DEFAULT_MAX_REPAIRS);
}

export function reuseBands(): { reuse: number; offer: number } {
  return {
    reuse: envNumber('AGENT_REUSE_REUSE', DEFAULT_REUSE_BAND),
    offer: envNumber('AGENT_REUSE_OFFER', DEFAULT_OFFER_BAND),
  };
}

export function judgeMinParams(): number {
  return envNumber('AGENT_JUDGE_MIN_PARAMS', DEFAULT_JUDGE_MIN_PARAMS);
}

export function archiveIdleDays(): number {
  return envNumber('AGENT_ARCHIVE_IDLE_DAYS', DEFAULT_ARCHIVE_IDLE_DAYS);
}

export function evalRuns(): number {
  return envNumber('AGENT_EVAL_RUNS', DEFAULT_EVAL_RUNS);
}
