import { z } from 'zod';
import { VerifiedLevel } from './enums.ts';

/**
 * Slice 32 Evals/Health surface (Task 19). Isomorphic — pure Zod, no
 * server/node import — projecting two engine-side sources onto the wire:
 * `EvalHistoryRow` (`src/self-improve/history.ts`, the append-only
 * `eval_history` store row) and `ManifestEntry.verifiedWith`
 * (`src/verified-build/types.ts`, the baseline model captured at the last
 * passing eval). Never carries golden-case text or raw model output — only
 * ids, model ids, counts, verdicts and a per-case pass/fail + short `detail`
 * string (mirrors `EvalCaseResult`, itself already free of case/output text).
 */

/** Wire mirror of `EvalCaseResult` (`src/verified-build/types.ts`). */
export const EvalCaseResultDtoSchema = z.object({
  id: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type EvalCaseResultDTO = z.infer<typeof EvalCaseResultDtoSchema>;

/** One `eval_history` row on the wire — mirrors `EvalHistoryRow`
 *  (`src/self-improve/history.ts`) field-for-field; feeds the trend view. */
export const EvalHistoryDtoSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  model: z.string(),
  baselineModel: z.string().optional(),
  ts: z.number(),
  passed: z.boolean(),
  passedCount: z.number(),
  total: z.number(),
  regressed: z.boolean(),
  perCase: z.array(EvalCaseResultDtoSchema),
  judgeModel: z.string(),
  belowBar: z.boolean(),
  reason: z.string().optional(),
});
export type EvalHistoryDTO = z.infer<typeof EvalHistoryDtoSchema>;

/** Per-artifact health rollup: baseline `verifiedWith` vs the latest eval
 *  verdict, the regressed flag, and the 👎 `chat.feedback` count. `latest` is
 *  absent for an artifact never re-evaluated (fresh manifest entry). */
export const EvalHealthDtoSchema = z.object({
  artifact: z.string(),
  verifiedLevel: z.enum(VerifiedLevel),
  baselineModel: z.string().optional(),
  currentModel: z.string().optional(),
  latest: EvalHistoryDtoSchema.optional(),
  regressed: z.boolean(),
  thumbsDown: z.number(),
});
export type EvalHealthDTO = z.infer<typeof EvalHealthDtoSchema>;

export const EvalHealthListResponseSchema = z.object({
  items: z.array(EvalHealthDtoSchema),
});
export type EvalHealthListResponse = z.infer<
  typeof EvalHealthListResponseSchema
>;

export const EvalHistoryListResponseSchema = z.object({
  items: z.array(EvalHistoryDtoSchema),
});
export type EvalHistoryListResponse = z.infer<
  typeof EvalHistoryListResponseSchema
>;

/** Trigger a re-eval: a single artifact (`ref` required) or a full sweep. */
export const EvalReevalRequestSchema = z
  .object({
    mode: z.enum(['artifact', 'all']),
    ref: z.string().min(1).optional(),
  })
  .refine((p) => p.mode !== 'artifact' || !!p.ref, {
    message: 'ref is required when mode is "artifact"',
    path: ['ref'],
  });
export type EvalReevalRequest = z.infer<typeof EvalReevalRequestSchema>;

export const EvalReevalResponseSchema = z.object({
  enqueued: z.number(),
  jobIds: z.array(z.string()),
});
export type EvalReevalResponse = z.infer<typeof EvalReevalResponseSchema>;
