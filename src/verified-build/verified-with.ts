import type { ModelDeclaration } from '../core/types.ts';
import type { VerifiedWith } from './types.ts';

/** Best-effort quant parse from a model tag (R2): matches a trailing/embedded
 *  `qN...` group like `q4_K_M` / `q4_0` / `q8_0`. Undefined when not present —
 *  a quant-only swap may then be invisible to the drift diff (accepted this slice). */
export function parseQuant(model: string): string | undefined {
  const m = model.match(/(q\d+(?:_[0-9a-z]+)*)/i);
  return m ? m[1] : undefined;
}

/** Capture the model identity a resolved declaration verified against, for
 *  the Slice 32 self-improvement baseline (drift detection needs this on disk). */
export function verifiedWithFrom(
  resolved: { decl: ModelDeclaration; numCtx: number },
  now: number = Date.now(),
): VerifiedWith {
  return {
    runtime: resolved.decl.runtime,
    model: resolved.decl.model,
    paramsBillions: resolved.decl.footprint.approxParamsBillions,
    numCtx: resolved.numCtx,
    quant: parseQuant(resolved.decl.model),
    capturedAtMs: now,
  };
}
