import { JobKind, JobStatus } from '../src/queue/types.ts';
import { reevalSweepCron } from '../src/self-improve/config.ts';
import { EvalMode } from '../src/server/jobs/dispatch.ts';
import type {
  CronConfig,
  JobChainConfig,
  TriggerInput,
} from '../src/triggers/types.ts';
import { TriggerType } from '../src/triggers/types.ts';
// TRIGGER-BUILDER:IMPORTS (generated trigger imports are inserted above this line — do not remove)

/** A repo-defined trigger never sets its own `origin` — `sync.ts` stamps
 *  `TriggerOrigin.Repo` on every entry as it syncs this registry into the
 *  store (mirrors `crews/index.ts` / `workflows/index.ts`). */
export type TriggerDef = Omit<TriggerInput, 'origin'>;

/** name -> repo trigger definition (mirrors crews/index.ts). `reeval-sweep` +
 *  `reeval-on-pull` are the Slice 32 self-improvement-loop detection triggers
 *  (D2): a periodic drift sweep and a hook off every completed
 *  `model.pull` job, both enqueuing a `JobKind.Eval` job. No new
 *  `TriggerType` — Cron + JobChain already exist (Slice 25). The master
 *  switch (`reevalEnabled()`) is NOT checked here: it gates execution
 *  (`src/self-improve/executor.ts`), not registration, so a disabled loop
 *  still shows both triggers (as disabled-effect, not absent) in the Ops
 *  console. `syncRepoTriggers` picks this registry up at daemon boot. */
export const TRIGGERS: Record<string, TriggerDef> = {
  'reeval-sweep': {
    name: 'reeval-sweep',
    type: TriggerType.Cron,
    target: {
      kind: JobKind.Eval,
      payload: { mode: EvalMode.Sweep, reason: 'sweep' },
    },
    config: { schedule: reevalSweepCron() } satisfies CronConfig,
  },
  'reeval-on-pull': {
    name: 'reeval-on-pull',
    type: TriggerType.JobChain,
    target: {
      kind: JobKind.Eval,
      payload: { mode: EvalMode.AffectedByPull, reason: 'pull' },
    },
    config: {
      onKind: JobKind.Pull,
      onStatus: JobStatus.Done,
    } satisfies JobChainConfig,
  },
  // TRIGGER-BUILDER:ENTRIES (generated trigger entries are inserted above this line — do not remove)
};

export function getTrigger(name: string): TriggerDef | undefined {
  // `Object.hasOwn` guard — a plain `TRIGGERS[name]` would return truthy
  // Object.prototype members for `__proto__`/`constructor`/`toString`, letting
  // those keys slip past every `if (!def)` 404/lookup guard (a spurious 500, or
  // a minted run dir for a non-existent trigger).
  return Object.hasOwn(TRIGGERS, name) ? TRIGGERS[name] : undefined;
}
