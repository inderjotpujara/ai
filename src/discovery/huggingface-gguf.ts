import {
  Capability,
  ContentPolicy,
  type ModelDeclaration,
  RuntimeKind,
} from '../core/types.ts';
import { downloadKindFor } from '../core/kind-map.ts';
import { kvCacheBytes, weightsBytes } from '../resource/footprint.ts';
import { MIN_CTX } from '../resource/model-manager.ts';
import type {
  Candidate,
  CatalogSource,
  DiscoveryQuery,
  HostCapabilities,
} from './catalog-source.ts';
import { hfGet } from './hf-client.ts';
import { bytesPerWeightForQuant } from './quant.ts';

export const TRUSTED_PUBLISHERS = [
  'bartowski',
  'unsloth',
  'MaziyarPanahi',
  'Qwen',
  'lmstudio-community',
];
const PER_AUTHOR_LIMIT = 20;
const UNCENSORED_RE = /(abliterated|uncensored|dolphin)/i;

/** Bytes-per-token for the KV cache — mirrors DEFAULT_KV_PER_TOKEN in model-manager. */
const DEFAULT_KV = 131072;

/** Full-precision quant labels to exclude from candidate selection. */
const FULL_PRECISION = new Set(['F16', 'F32', 'FP16', 'BF16']);

/**
 * Regex to extract a quant token from anywhere in a filename (case-insensitive).
 * Matches IQ-style and Q-digit-style quants.
 */
const QUANT_TOKEN_RE = /\b(IQ\d\w*|Q\d[\w_]*)\b/i;

/** True if a chat template exposes tool/function calling. */
export function detectTools(chatTemplate: string): boolean {
  return /tool_call|tools|function/i.test(chatTemplate);
}

type ListItem = { id: string; downloads?: number };
type GgufInfo = {
  gguf?: { total?: number; context_length?: number; chat_template?: string };
};
type TreeEntry = { path: string; size?: number; lfs?: { size?: number } };

/** Extract a quant label from anywhere in a filename. Returns uppercase or undefined. */
function quantOf(path: string): string | undefined {
  const m = path.match(QUANT_TOKEN_RE);
  return m?.[1]?.toUpperCase();
}

async function candidateFor(
  item: ListItem,
  q: DiscoveryQuery,
): Promise<Candidate | undefined> {
  const repo = item.id;
  let info: GgufInfo;
  try {
    info = (await hfGet(`/api/models/${repo}`)) as GgufInfo;
  } catch {
    return undefined;
  }
  const tmpl = info.gguf?.chat_template ?? '';
  if (q.requires?.includes(Capability.Tools) && !detectTools(tmpl))
    return undefined;

  let tree: TreeEntry[];
  try {
    tree = (await hfGet(`/api/models/${repo}/tree/main`)) as TreeEntry[];
  } catch {
    return undefined;
  }

  // Group shards by quant label, summing their sizes.
  // Exclude full-precision files and mmproj/projector files.
  const quantSums = new Map<string, number>();
  for (const e of tree) {
    const filename = e.path.split('/').pop() ?? e.path;
    if (/mmproj|projector/i.test(filename)) continue;

    const quant = quantOf(filename);
    if (!quant) continue;
    if (FULL_PRECISION.has(quant)) continue;

    const sizeBytes = e.lfs?.size ?? e.size;
    if (typeof sizeBytes !== 'number') continue;

    quantSums.set(quant, (quantSums.get(quant) ?? 0) + sizeBytes);
  }

  // Select the best quant: footprint <= budgetBytes, then largest summedBytes wins.
  let bestQuant: string | undefined;
  let bestSummedBytes = 0;

  for (const [quant, summedBytes] of quantSums) {
    const bpw = bytesPerWeightForQuant(quant);
    const approxParamsBillions = summedBytes / 1e9 / bpw;
    const footprint =
      weightsBytes(approxParamsBillions, bpw) +
      kvCacheBytes(MIN_CTX, DEFAULT_KV);

    if (footprint > q.budgetBytes) continue;

    if (summedBytes > bestSummedBytes) {
      bestSummedBytes = summedBytes;
      bestQuant = quant;
    }
  }

  if (!bestQuant) return undefined;

  const bpw = bytesPerWeightForQuant(bestQuant);
  const approxParamsBillions = bestSummedBytes / 1e9 / bpw;

  const decl: ModelDeclaration = {
    runtime: RuntimeKind.Ollama,
    model: `hf.co/${repo}:${bestQuant}`,
    params: {},
    role: 'discovered general reasoning + tool use',
    capabilities: detectTools(tmpl) ? [Capability.Tools] : [],
    contentPolicy: UNCENSORED_RE.test(repo)
      ? ContentPolicy.Uncensored
      : ContentPolicy.Default,
    footprint: {
      approxParamsBillions,
      bytesPerWeight: bpw,
    },
    maxContext: info.gguf?.context_length,
  };
  return {
    ...decl,
    provider: downloadKindFor(RuntimeKind.Ollama, 'gguf-file'),
    repo,
    quant: bestQuant,
    fileSizeBytes: bestSummedBytes,
    downloads: item.downloads ?? 0,
    installed: false,
  };
}

export const hfGgufSource: CatalogSource = {
  name: 'hf-gguf',
  appliesTo: (_host: HostCapabilities) => true, // Ollama runs GGUF on every host
  async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
    const items: ListItem[] = [];
    for (const author of TRUSTED_PUBLISHERS) {
      try {
        const page = (await hfGet(
          `/api/models?filter=gguf&author=${author}&sort=downloads&direction=-1&limit=${PER_AUTHOR_LIMIT}`,
        )) as ListItem[];
        items.push(...page);
      } catch {
        /* skip this author on failure; degrade gracefully */
      }
    }
    const out: Candidate[] = [];
    for (const item of items) {
      const c = await candidateFor(item, q);
      if (c) out.push(c);
    }
    return out;
  },
};
