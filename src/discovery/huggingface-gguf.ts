import { Capability, ContentPolicy, type ModelDeclaration, ProviderKind } from '../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from './catalog-source.ts';
import { hfGet } from './hf-client.ts';
import { bytesPerWeightForQuant, pickBestQuantThatFits, type QuantFile } from './quant.ts';

export const TRUSTED_PUBLISHERS = ['bartowski', 'unsloth', 'MaziyarPanahi', 'Qwen', 'lmstudio-community'];
const PER_AUTHOR_LIMIT = 20;
const UNCENSORED_RE = /(abliterated|uncensored|dolphin)/i;
const QUANT_RE = /-(IQ?\d[\w_]*|Q\d[\w_]*|F16|FP16)\.gguf$/i;

/** True if a chat template exposes tool/function calling. */
export function detectTools(chatTemplate: string): boolean {
  return /tool_call|tools|function/i.test(chatTemplate);
}

type ListItem = { id: string; downloads?: number };
type GgufInfo = { gguf?: { total?: number; context_length?: number; chat_template?: string } };
type TreeEntry = { path: string; size?: number; lfs?: { size?: number } };

function quantOf(path: string): string | undefined {
  const m = path.match(QUANT_RE);
  return m?.[1]?.toUpperCase();
}

async function candidateFor(item: ListItem, q: DiscoveryQuery): Promise<Candidate | undefined> {
  const repo = item.id;
  let info: GgufInfo;
  try { info = (await hfGet(`/api/models/${repo}`)) as GgufInfo; } catch { return undefined; }
  const tmpl = info.gguf?.chat_template ?? '';
  if (q.requires?.includes(Capability.Tools) && !detectTools(tmpl)) return undefined;

  let tree: TreeEntry[];
  try { tree = (await hfGet(`/api/models/${repo}/tree/main`)) as TreeEntry[]; } catch { return undefined; }
  const files: QuantFile[] = [];
  for (const e of tree) {
    const quant = quantOf(e.path);
    const sizeBytes = e.lfs?.size ?? e.size;
    if (quant && typeof sizeBytes === 'number') files.push({ quant, sizeBytes });
  }
  const best = pickBestQuantThatFits(files, q.budgetBytes);
  if (!best) return undefined;

  const params = (info.gguf?.total ?? 0) / 1e9;
  const decl: ModelDeclaration = {
    provider: ProviderKind.Ollama,
    model: `hf.co/${repo}:${best.quant}`,
    params: {},
    role: 'discovered general reasoning + tool use',
    capabilities: detectTools(tmpl) ? [Capability.Tools] : [],
    contentPolicy: UNCENSORED_RE.test(repo) ? ContentPolicy.Uncensored : ContentPolicy.Default,
    footprint: {
      approxParamsBillions: params > 0 ? params : best.sizeBytes / 1e9 / bytesPerWeightForQuant(best.quant),
      bytesPerWeight: bytesPerWeightForQuant(best.quant),
    },
    maxContext: info.gguf?.context_length,
  };
  return { ...decl, repo, quant: best.quant, fileSizeBytes: best.sizeBytes, downloads: item.downloads ?? 0, installed: false };
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
      } catch { /* skip this author on failure; degrade gracefully */ }
    }
    const out: Candidate[] = [];
    for (const item of items) {
      const c = await candidateFor(item, q);
      if (c) out.push(c);
    }
    return out;
  },
};
