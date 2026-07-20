# Task 3 report: Trigger DTOs + request/response schemas (Slice 25, Increment 4)

(Note: this file previously held a report for an unrelated task — Slice 25b
Incr 1's DaemonStatus/DaemonBind/QueueStats DTOs — that reused this same
filename. Overwritten with this Slice 25 Task 3 report.)

## Status: DONE

## Commit
`aec170f` — feat(contracts): trigger DTOs + request/response schemas

## What was done

### `src/contracts/dto.ts`
- Added `TriggerDtoSchema`/`TriggerDTO`, inserted immediately after `JobDtoSchema` per the brief's placement instruction. Fields exactly as specified: `id, name, type (TriggerTypeWire), enabled, target { kind: JobKindWire, payload: unknown }, config: unknown, origin (TriggerOriginWire), nextRunAt?, lastFiredAt?, createdAt, updatedAt, webhookUrl?`.
- Added `TriggerFiringDtoSchema`/`TriggerFiringDTO` right after it: `id, triggerId, firedAt, jobId?, runId?, outcome (TriggerOutcomeWire)`.
- Extended the `enums.ts` import with `TriggerOriginWire`, `TriggerOutcomeWire`, `TriggerTypeWire`.
- Doc comments cite Slice 25 and explicitly call out the security rule (no token/secret field on `TriggerDtoSchema`; `webhookUrl` is the public fire endpoint, not the secret path token).

### `src/contracts/requests.ts`
- Added per-type config schemas exactly per brief: `CronConfigSchema`, `WebhookConfigSchema`, `FileConfigSchema`, `JobChainConfigSchema` (each with its own inferred type export, following the file's `export type Xxx = z.infer<...>` idiom used throughout).
- Added `TriggerCreateRequestSchema`/`TriggerCreateRequest`, `TriggerPatchRequestSchema`/`TriggerPatchRequest`, `TriggerCreateResponseSchema`/`TriggerCreateResponse`, `TriggerListResponseSchema`/`TriggerListResponse`, `TriggerFiringListQuerySchema`/`TriggerFiringListQuery`, `TriggerFiringListResponseSchema`/`TriggerFiringListResponse` — all field shapes verbatim from the brief.
- Imported `TriggerDtoSchema`/`TriggerFiringDtoSchema` from `./dto.ts` and `TriggerTypeWire` from `./enums.ts`.
- Did NOT add a new fire-response schema — per the brief, `JobLaunchResponseSchema` (`{ jobId, runId }`) is reused as-is for that later (Task 23/API-route work); nothing new needed here.
- `index.ts` re-exports both files via `export *`, so no changes needed there.

### `tests/contracts/trigger-dto.test.ts` (new)
- The two tests from the brief verbatim (cron round-trip; bad-outcome rejection), plus one extra test asserting `TriggerDtoSchema` strips/never carries a `token` field (defense-in-depth check on the security rule, not strictly required but cheap and directly verifies §7.1).

## Security review (§7.1)

Checked the brief's field list against the "no token/secret in TriggerDto" rule before implementing: **no conflict found**. The brief's `TriggerDtoSchema` field list never included a token/hash/secret field, and `WebhookConfigSchema` (the only per-type config touching webhooks) only has an optional `hmac: boolean` flag — no secret material. The raw webhook path token lives solely in `TriggerCreateResponseSchema.webhookToken` (once-only), matching the `DevicePairResponseSchema` precedent as instructed. Nothing needed to be overridden or flagged.

## Gate results
- `bun run typecheck` — clean, no errors.
- `bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/trigger-dto.test.ts` — clean after one `biome check --write` auto-format pass (2 formatting-only diffs, no logic changes).
- `bun run test:file -- tests/contracts/trigger-dto.test.ts` — 3 pass, 0 fail.
- `bun run test:file -- tests/contracts/` (full contracts suite regression check) — 132 pass, 0 fail, 205 expect() calls.

## Concerns
None. Schemas match the brief exactly; no conflict between the field list and the security rule to flag.
