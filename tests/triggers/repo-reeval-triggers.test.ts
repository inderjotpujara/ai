import { describe, expect, test } from 'bun:test';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import { EvalMode } from '../../src/server/jobs/dispatch.ts';
import type { CronConfig, JobChainConfig } from '../../src/triggers/types.ts';
import { TriggerType } from '../../src/triggers/types.ts';
import { TRIGGERS } from '../../triggers/index.ts';

describe('repo reeval trigger defs (Slice 32, Task 17)', () => {
  test('repo registry defines a Cron sweep + a Pull JobChain, both targeting JobKind.Eval', () => {
    expect(TRIGGERS['reeval-sweep']?.type).toBe(TriggerType.Cron);
    expect(TRIGGERS['reeval-sweep']?.target.kind).toBe(JobKind.Eval);
    expect(TRIGGERS['reeval-on-pull']?.type).toBe(TriggerType.JobChain);
    expect(
      (TRIGGERS['reeval-on-pull']?.config as { onKind: JobKind }).onKind,
    ).toBe(JobKind.Pull);
    expect(
      (TRIGGERS['reeval-on-pull']?.config as { onStatus: JobStatus }).onStatus,
    ).toBe(JobStatus.Done);
  });

  test('the Cron sweep schedule comes from the reevalSweepCron() knob', () => {
    const cfg = TRIGGERS['reeval-sweep']?.config as CronConfig;
    expect(cfg.schedule).toBe('0 4 * * *');
  });

  test('both defs target JobKind.Eval with the matching EvalMode payload', () => {
    expect(
      (TRIGGERS['reeval-sweep']?.target.payload as { mode: EvalMode }).mode,
    ).toBe(EvalMode.Sweep);
    expect(
      (TRIGGERS['reeval-on-pull']?.target.payload as { mode: EvalMode }).mode,
    ).toBe(EvalMode.AffectedByPull);
  });

  test('the JobChain def config matches JobChainConfig shape (onKind=Pull, onStatus=Done)', () => {
    const cfg = TRIGGERS['reeval-on-pull']?.config as JobChainConfig;
    expect(cfg.onKind).toBe(JobKind.Pull);
    expect(cfg.onStatus).toBe(JobStatus.Done);
  });
});
