import {
  Capability,
  ContentPolicy,
  type ModelDeclaration,
  ProviderKind,
} from '../core/types.ts';
import type {
  Candidate,
  CatalogSource,
  DiscoveryQuery,
  HostCapabilities,
} from './catalog-source.ts';
import { hfGet } from './hf-client.ts';
import { detectTools } from './huggingface-gguf.ts';

const TRUSTED = ['mlx-community'];
const LIMIT = 20;
const UNCENSORED_RE = /(abliterated|uncensored|dolphin)/i;

type ListItem = { id: string; downloads?: number };
type TreeEntry = { path: string; size?: number; lfs?: { size?: number } };
type TokCfg = { chat_template?: string };
type Cfg = { num_parameters?: number };

async function candidateFor(
  item: ListItem,
  q: DiscoveryQuery,
): Promise<Candidate | undefined> {
  const repo = item.id;
  let tok: TokCfg;
  try {
    tok = (await hfGet(
      `/${repo}/resolve/main/tokenizer_config.json`,
    )) as TokCfg;
  } catch {
    return undefined;
  }
  const tmpl = tok.chat_template ?? '';
  if (q.requires?.includes(Capability.Tools) && !detectTools(tmpl))
    return undefined;

  let cfg: Cfg = {};
  try {
    cfg = (await hfGet(`/${repo}/resolve/main/config.json`)) as Cfg;
  } catch {
    /* params optional */
  }

  let tree: TreeEntry[];
  try {
    tree = (await hfGet(`/api/models/${repo}/tree/main`)) as TreeEntry[];
  } catch {
    return undefined;
  }
  const total = tree
    .filter((e) => e.path.endsWith('.safetensors'))
    .reduce((s, e) => s + (e.lfs?.size ?? e.size ?? 0), 0);
  if (total === 0 || total > q.budgetBytes) return undefined;

  const params = (cfg.num_parameters ?? 0) / 1e9;
  const bpw = params > 0 ? total / 1e9 / params : 0.55;
  const decl: ModelDeclaration = {
    provider: ProviderKind.MlxServer,
    model: repo,
    params: {},
    role: 'discovered MLX general reasoning + tool use',
    capabilities: detectTools(tmpl) ? [Capability.Tools] : [],
    contentPolicy: UNCENSORED_RE.test(repo)
      ? ContentPolicy.Uncensored
      : ContentPolicy.Default,
    footprint: {
      approxParamsBillions: params > 0 ? params : total / 1e9 / 0.55,
      bytesPerWeight: bpw,
    },
  };
  return {
    ...decl,
    repo,
    quant: '4bit',
    fileSizeBytes: total,
    downloads: item.downloads ?? 0,
    installed: false,
  };
}

export const hfMlxSource: CatalogSource = {
  name: 'hf-mlx',
  appliesTo: (host: HostCapabilities) =>
    host.runtimes.includes(ProviderKind.MlxServer),
  async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
    const items: ListItem[] = [];
    for (const author of TRUSTED) {
      try {
        const page = (await hfGet(
          `/api/models?filter=mlx&author=${author}&sort=downloads&direction=-1&limit=${LIMIT}`,
        )) as ListItem[];
        items.push(...page);
      } catch {
        /* degrade */
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
