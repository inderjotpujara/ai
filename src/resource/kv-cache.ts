/** KV-cache quantization policy. Type is global (Ollama); sizing+risk are per-model, arch-derived. */
export enum KvCacheType {
  F16 = 'f16',
  Q8_0 = 'q8_0',
  Q4_0 = 'q4_0',
}

/** GGUF attention dims (from /api/show) needed to size + risk-assess the KV cache. */
export type KvArch = {
  blockCount: number;
  headCountKv: number;
  keyLength: number;
  valueLength: number;
  expertCount: number;
};

const MULTIPLIER: Record<KvCacheType, number> = {
  [KvCacheType.F16]: 1.0,
  [KvCacheType.Q8_0]: 0.5,
  [KvCacheType.Q4_0]: 0.25,
};

/** RAM multiplier on the f16 KV baseline for a cache type. */
export function kvCacheMultiplier(type: KvCacheType): number {
  return MULTIPLIER[type];
}

/** Active type from AGENT_KV_CACHE_TYPE; default q8_0; unrecognized → q8_0. */
export function activeKvCacheType(): KvCacheType {
  const raw = (process.env.AGENT_KV_CACHE_TYPE ?? '').toLowerCase();
  return (Object.values(KvCacheType) as string[]).includes(raw)
    ? (raw as KvCacheType)
    : KvCacheType.Q8_0;
}

/** f16 KV bytes/token from real arch: layers × kv-heads × (k+v head dims) × 2 bytes. */
export function f16KvBytesPerToken(a: KvArch): number {
  return a.blockCount * a.headCountKv * (a.keyLength + a.valueLength) * 2;
}

/** Effective KV bytes/token for sizing: f16 baseline × the active type's multiplier. */
export function effectiveKvBytesPerToken(f16Baseline: number): number {
  return Math.round(f16Baseline * kvCacheMultiplier(activeKvCacheType()));
}

/** Generalized, arch-derived risk: small head_dim or MoE routing degrade more under KV quant. */
export function isKvQuantRisky(a: KvArch): boolean {
  return a.keyLength <= 64 || a.expertCount > 0;
}
