import type { ProviderKind } from '../core/types.ts';
import type { Candidate } from '../discovery/catalog-source.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget } from '../resource/hardware.ts';

export type FitCandidate = Candidate & {
  estimatedBytes: number;
  fits: boolean;
  recommended: boolean;
};

const DEFAULT_KV_PER_TOKEN = 131072;
const FIT_CONTEXT_TOKENS = 8192; // sizing context for the fit estimate

// Sizing keep-decision (Slice-14 follow-on, WS4/Task-16): candidates get their
// size from `fileSizeBytes` (HF tree API / Ollama manifest — see
// discovery/huggingface-gguf.ts and provisioning/catalog/*) with the
// weights+KV estimate below as a fallback/floor. We deliberately did NOT add
// `gguf-parser-go` (a Go binary dependency) to parse remote GGUF headers for
// sizing — the HF-tree/manifest sizes are accurate enough and keep this a
// pure-JS/TS stack. Revisit only if that sizing proves unreliable in practice.

/** Filter to models that fit, rank largest-that-fits, mark top-per-runtime recommended. */
export function fitAndRank(
  candidates: Candidate[],
  budgetBytes: number,
): FitCandidate[] {
  const scored = candidates.map((c) => {
    const estimatedBytes = Math.max(
      c.fileSizeBytes,
      estimateModelBytes({
        paramsBillions: c.footprint.approxParamsBillions,
        bytesPerWeight: c.footprint.bytesPerWeight,
        contextTokens: FIT_CONTEXT_TOKENS,
        kvBytesPerToken: c.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN,
      }),
    );
    return {
      ...c,
      estimatedBytes,
      fits: fitsBudget(estimatedBytes, budgetBytes),
      recommended: false,
    };
  });
  const fitting = scored
    .filter((c) => c.fits)
    .sort(
      (a, b) =>
        b.footprint.approxParamsBillions - a.footprint.approxParamsBillions,
    );
  const seen = new Set<ProviderKind>();
  for (const c of fitting) {
    if (hasNoSizingSignal(c)) continue;
    if (!seen.has(c.provider)) {
      c.recommended = true;
      seen.add(c.provider);
    }
  }
  return fitting;
}

/** True for unenriched placeholder candidates (pre-Task-4 enrichment) with no real size or param evidence. */
function hasNoSizingSignal(c: Candidate): boolean {
  return c.fileSizeBytes <= 0 && c.footprint.approxParamsBillions <= 0;
}
