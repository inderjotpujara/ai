import {
  type TriggerDTO,
  TriggerDtoSchema,
  type TriggerFiringDTO,
  TriggerFiringDtoSchema,
} from '../../contracts/index.ts';
import type { Trigger, TriggerFiring } from '../../triggers/types.ts';
import { TriggerType } from '../../triggers/types.ts';

/**
 * `Trigger` (`src/triggers/types.ts`) -> `TriggerDTO` (wire). Projects the
 * store record EXPLICITLY field-by-field — never a spread — so `secretRef`
 * (the HMAC secret pointer, never on the wire, §7.1) can't leak even if a
 * future field is added to `Trigger`. `type`/`origin` are domain enums whose
 * string values are isomorphic to their `*Wire` counterparts (guarded by
 * `tests/contracts/trigger-enum-parity.test.ts`), so they pass straight into
 * `TriggerDtoSchema.parse` — same idiom as `toJobDto`.
 *
 * `webhookUrl` is populated ONLY for a webhook trigger when a `publicBaseUrl`
 * is supplied, and is the trigger's BASE fire path (`${publicBaseUrl}/hooks`)
 * — never the raw per-trigger token. The stored record only ever holds
 * `tokenHash`, not the raw token, so the token can't be reconstructed here;
 * it is transmitted exactly once, in `TriggerCreateResponseSchema` at create
 * time (Task 23).
 */
export function toTriggerDto(
  t: Trigger,
  opts?: { publicBaseUrl?: string },
): TriggerDTO {
  return TriggerDtoSchema.parse({
    id: t.id,
    name: t.name,
    type: t.type,
    enabled: t.enabled,
    target: t.target,
    config: t.config,
    origin: t.origin,
    nextRunAt: t.nextRunAt,
    lastFiredAt: t.lastFiredAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    webhookUrl:
      t.type === TriggerType.Webhook && opts?.publicBaseUrl
        ? `${opts.publicBaseUrl}/hooks`
        : undefined,
  });
}

/** `TriggerFiring` (`src/triggers/types.ts`) -> `TriggerFiringDTO` (wire). */
export function toTriggerFiringDto(f: TriggerFiring): TriggerFiringDTO {
  return TriggerFiringDtoSchema.parse({
    id: f.id,
    triggerId: f.triggerId,
    firedAt: f.firedAt,
    jobId: f.jobId,
    runId: f.runId,
    outcome: f.outcome,
  });
}
