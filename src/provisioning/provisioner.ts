import type { ProviderKind } from '../core/types.ts';
import type {
  Candidate,
  CatalogSource,
  HostCapabilities,
} from '../discovery/catalog-source.ts';
import { ATTR, withProvisionSpan } from '../telemetry/spans.ts';
import { type FitCandidate, fitAndRank } from './fit.ts';
import { checkDiskSpace } from './supervisor.ts';
import {
  DownloadPhase,
  type DownloadProgress,
  type DownloadProvider,
} from './types.ts';

export type ProvisionResult = {
  downloaded: string[];
  declined: string[];
  failed: Array<{ model: string; error: string }>;
  deferred: string[];
};

export type ProvisionUi = {
  askYesNo: (q: string) => Promise<boolean>;
  selectModels: (items: FitCandidate[]) => Promise<FitCandidate[]>;
  bar: {
    render: (p: DownloadProgress) => void;
    done: (p: DownloadProgress) => void;
  };
};

export type ProvisionDeps = {
  detectHost: () => Promise<HostCapabilities>;
  catalogSources: CatalogSource[];
  providerFor: (kind: ProviderKind) => DownloadProvider;
  enrichSize: (c: Candidate) => Promise<number>;
  freeDiskBytes: () => Promise<number>;
  ui: ProvisionUi;
};

/** Orchestrates the first-boot flow. All deps injectable; degrade-never-crash. */
export async function runProvision(opts: {
  deps: ProvisionDeps;
  autoYes?: boolean;
}): Promise<ProvisionResult> {
  const { deps } = opts;
  const result: ProvisionResult = {
    downloaded: [],
    declined: [],
    failed: [],
    deferred: [],
  };

  const host = await deps.detectHost();

  // 1) Discover across applicable sources; degrade per-source (a throw yields []).
  const query = {
    budgetBytes: host.liveBudgetBytes,
    hostTotalRamBytes: host.totalRamBytes,
  };
  const lists = await Promise.all(
    deps.catalogSources
      .filter((s) => s.appliesTo(host))
      .map((s) => s.listCandidates(query).catch(() => [] as Candidate[])),
  );
  const candidates = lists.flat();

  // 2) Fit-filter + rank; recommended pre-marked.
  const ranked = fitAndRank(candidates, host.liveBudgetBytes);
  if (ranked.length === 0) return result;

  // 3) Enrich sizes for the shown set (lazy; degrade to existing size on failure).
  for (const c of ranked) {
    if (c.fileSizeBytes <= 0) {
      try {
        c.fileSizeBytes = await deps.enrichSize(c);
      } catch {
        /* leave as-is; UI shows best-effort size */
      }
    }
  }

  // 4) Consent: per-model selection (recommended pre-selected).
  const selected = await deps.ui.selectModels(ranked);
  if (selected.length === 0) return result;

  // 5) Disk preflight over the selected set.
  const required = selected.reduce(
    (s, c) => s + Math.max(c.fileSizeBytes, c.estimatedBytes),
    0,
  );
  const free = await deps.freeDiskBytes();
  const pre = checkDiskSpace({ requiredBytes: required, freeBytes: free });
  if (!pre.ok) {
    const ok = await deps.ui.askYesNo(
      `Need ~${Math.round(required / 1e9)}GB but only ~${Math.round(free / 1e9)}GB free (short ~${Math.round(pre.shortfallBytes / 1e9)}GB). Continue anyway?`,
    );
    if (!ok) {
      for (const c of selected) result.declined.push(c.model);
      return result;
    }
  }

  // 6) Sequential download with a live bar; degrade-never-crash per model.
  return withProvisionSpan(
    {
      candidateCount: ranked.length,
      selectedCount: selected.length,
      bytesTotal: required,
      snapshotFallback: false,
    },
    async (span) => {
      const ctrl = new AbortController();
      const destDir =
        process.env.HF_HOME ??
        process.env.OLLAMA_MODELS ??
        `${process.cwd()}/model-images`;
      for (const c of selected) {
        try {
          const provider = deps.providerFor(c.provider);
          await provider.download(c.model, {
            onProgress: (p) =>
              p.phase === DownloadPhase.Done || p.phase === DownloadPhase.Failed
                ? deps.ui.bar.done(p)
                : deps.ui.bar.render(p),
            signal: ctrl.signal,
            destDir,
          });
          result.downloaded.push(c.model);
        } catch (err) {
          result.failed.push({
            model: c.model,
            error: (err as Error).message,
          });
        }
      }
      span.setAttribute(
        ATTR.PROVISION_DOWNLOADED_COUNT,
        result.downloaded.length,
      );
      span.setAttribute(ATTR.PROVISION_FAILED_COUNT, result.failed.length);
      return result;
    },
  );
}
