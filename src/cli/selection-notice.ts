import type { ModelDeclaration } from '../core/types.ts';
import { kvCacheBytes, weightsBytes } from '../resource/footprint.ts';
import { activeKvCacheType } from '../resource/kv-cache.ts';

const gb = (b: number): string => (b / 1e9).toFixed(1);

export type NoticeInput = {
  decl: ModelDeclaration;
  numCtx: number;
  kvBytesPerToken: number;
  budgetBytes: number;
  installed: boolean;
};

/** Human-readable heads-up about the model chosen for a delegation. */
export function formatSelectionNotice(i: NoticeInput): string {
  const f = i.decl.footprint;
  const w = weightsBytes(f.approxParamsBillions, f.bytesPerWeight);
  const kv = kvCacheBytes(i.numCtx, i.kvBytesPerToken);
  const install = i.installed ? 'installed' : 'not installed — will pull';
  return [
    `▸ selected ${i.decl.model}`,
    `  ${f.approxParamsBillions.toFixed(1)}B · weights ≈${gb(w)}GB + KV ≈${gb(kv)}GB @ ${i.numCtx} ctx = ≈${gb(w + kv)}GB · KV ${activeKvCacheType()}`,
    `  live budget ≈${gb(i.budgetBytes)}GB · ${install}`,
  ].join('\n');
}
