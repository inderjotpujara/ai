import type { HostCapabilities } from '../discovery/catalog-source.ts';
import { detectHost } from '../discovery/host.ts';
import type { ProvisionDeps } from './provisioner.ts';
import { catalogSourcesFor, enrichSize, providerFor } from './registry.ts';
import { formatBytes } from './ui/format.ts';
import { ProgressBar } from './ui/progress-bar.ts';
import { askYesNo, selectModels, stdinInput } from './ui/prompt.ts';

/** Free disk space on the models volume; conservative fallback keeps preflight non-fatal. */
export async function freeDiskBytes(): Promise<number> {
  try {
    const { statfs } = await import('node:fs/promises');
    const s = await statfs(process.env.OLLAMA_MODELS ?? process.cwd());
    return s.bavail * s.bsize;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Shared deps-wiring for both `provision.ts` and the chat.ts auto-detect hook. */
export function buildProvisionDeps(
  host: HostCapabilities,
  opts: { autoYes: boolean },
): ProvisionDeps {
  const input = stdinInput();
  const bar = new ProgressBar(process.stderr, process.stderr.isTTY ?? false);
  return {
    detectHost: async () => host,
    catalogSources: catalogSourcesFor(host),
    providerFor,
    enrichSize,
    freeDiskBytes,
    ui: {
      askYesNo: (q) => askYesNo(q, { input, autoYes: opts.autoYes }),
      selectModels: (items) =>
        selectModels(items, {
          input,
          autoYes: opts.autoYes,
          label: (c) =>
            `${c.model}  (${formatBytes(c.fileSizeBytes || c.estimatedBytes)})`,
        }),
      bar,
    },
  };
}

export { detectHost };
