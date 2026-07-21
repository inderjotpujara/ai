import type { JobKind, JobStatus } from '../queue/types.ts';

export enum TriggerType {
  Cron = 'cron',
  Webhook = 'webhook',
  File = 'file',
  JobChain = 'jobchain',
}

export enum TriggerOrigin {
  Repo = 'repo',
  Console = 'console',
}

export enum TriggerOutcome {
  Fired = 'fired',
  SkippedOverlap = 'skipped-overlap',
  Failed = 'failed',
}

export enum FileEventKind {
  Add = 'add',
  Change = 'change',
}

export type CronConfig = {
  schedule: string;
  timezone?: string;
  catchUp?: boolean;
  allowOverlap?: boolean;
};

export type WebhookConfig = {
  hmac?: boolean;
};

export type FileConfig = {
  path: string;
  events?: FileEventKind[];
};

export type JobChainConfig = {
  onKind?: JobKind;
  onName?: string;
  onStatus: JobStatus;
};

export type TriggerConfig =
  | CronConfig
  | WebhookConfig
  | FileConfig
  | JobChainConfig;

export type TriggerTarget = {
  kind: JobKind;
  payload: unknown;
};

export type Trigger = {
  id: string;
  name: string;
  type: TriggerType;
  enabled: boolean;
  target: TriggerTarget;
  config: TriggerConfig;
  origin: TriggerOrigin;
  nextRunAt?: number;
  lastFiredAt?: number;
  secretRef?: string;
  createdAt: number;
  updatedAt: number;
};

export type TriggerFiring = {
  id: string;
  triggerId: string;
  firedAt: number;
  jobId?: string;
  runId?: string;
  outcome: TriggerOutcome;
};

export type TriggerInput = {
  name: string;
  type: TriggerType;
  enabled?: boolean;
  target: TriggerTarget;
  config: TriggerConfig;
  origin: TriggerOrigin;
  secretRef?: string;
  nextRunAt?: number;
};

/** Injected dependencies for `createTriggerStore` (mirrors `JobStoreDeps`).
 *  Empty today — the store owns its DB; the scheduler injects `computeNext`
 *  per-call into `claimDueCron`, not via construction. */
export type TriggerStoreDeps = Record<string, never>;
