/**
 * Boot-time sync of the repo-defined trigger registry (`triggers/index.ts`)
 * into the SQLite trigger store (Slice 25, Task 14).
 *
 * Mirrors the crew/workflow "registry -> store" sync shape: repo defs are
 * upserted by name (origin=repo), then any repo row no longer present in the
 * registry is pruned. `TriggerStore.upsertRepo` already preserves the
 * console pause/resume `enabled` overlay across a re-sync (see store.ts) —
 * this module only orchestrates the per-def upsert + the trailing prune.
 *
 * I1(b): a repo CRON def must be validated before it reaches the scheduler.
 * An invalid pattern/timezone is registered anyway (so the operator can see
 * and fix it in the console) but forced `enabled: false` — never thrown. A
 * bad repo cron file must not be able to crash daemon boot.
 *
 * T7 carry: a repo TS file must not hold a raw webhook secret, so repo
 * webhooks can't be server-token-minted the way console-authored ones are —
 * they are console-authored only. A repo `TriggerType.Webhook` def is
 * therefore registered visibly-disabled (never silently non-functional):
 * `upsertRepo` never sets `token_hash` for it, so `getByTokenHash` could
 * never match it anyway; forcing `enabled: false` + a warn makes that
 * explicit instead of leaving a dead row that looks live in the console.
 */
import type { TriggerDef } from '../../triggers/index.ts';
import { createLogger } from '../log/logger.ts';
import { validateCron } from './next-run.ts';
import type { TriggerStore } from './store.ts';
import { type CronConfig, TriggerOrigin, TriggerType } from './types.ts';

const log = createLogger('triggers.sync');

/** Upsert every repo-defined trigger by name, force-disabling any cron def
 *  with an invalid pattern/timezone, then prune repo rows no longer defined. */
export function syncRepoTriggers(
  store: TriggerStore,
  defs: Record<string, TriggerDef>,
): void {
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === TriggerType.Cron) {
      const cfg = def.config as CronConfig;
      if (!validateCron(cfg.schedule, cfg.timezone)) {
        store.upsertRepo({
          ...def,
          origin: TriggerOrigin.Repo,
          enabled: false,
        });
        log.warn('trigger.sync.invalid-cron', { triggerName: name });
        continue;
      }
    }
    if (def.type === TriggerType.Webhook) {
      store.upsertRepo({
        ...def,
        origin: TriggerOrigin.Repo,
        enabled: false,
      });
      log.warn('trigger.sync.webhook-unsupported', { triggerName: name });
      continue;
    }
    store.upsertRepo({ ...def, origin: TriggerOrigin.Repo });
  }
  store.pruneRepo(Object.keys(defs));
}
