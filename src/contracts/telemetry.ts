import { z } from 'zod';

/**
 * Wire mirror of web's `ModelTier` values (web/src/features/voice/model-tier.ts).
 * `src/contracts/` is isomorphic (no web import), so the two Moonshine tiers are
 * mirrored here rather than shared by import — the same precedent `CaptureSource`
 * set in Slice 30b Phase 7 (D5). Slice 30b Phase 8, D10.
 */
export const VOICE_MODEL_TIERS = ['moonshine-base', 'moonshine-tiny'] as const;

/**
 * The client→server telemetry beacon body (spec §4.1, D10). A discriminated
 * union with ONE variant today; written as a union so a future phase can add a
 * second event kind without a schema break (§9). The `kind` discriminant equals
 * the emitted span name 1:1 (`voice.transcribe.web`) so it never conflates with
 * the pre-existing CLI-side `voice.transcribe` span (D10).
 */
export const TelemetryEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('voice.transcribe.web'),
    durationMs: z.number().nonnegative(),
    wordCount: z.number().int().nonnegative(),
    modelTier: z.enum(VOICE_MODEL_TIERS),
    realTimeFactor: z.number().nonnegative(),
    engine: z.string().min(1),
  }),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
