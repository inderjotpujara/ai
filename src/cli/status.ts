import { RuntimeKind } from '../core/types.ts';
import { probeTimeoutMs } from '../reliability/config.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { APP_VERSION } from '../version.ts';

const OLLAMA_BASE = 'http://localhost:11434';

export type StatusDeps = {
  ollamaReachable: () => Promise<boolean>;
  loadedModels: () => Promise<string[]>;
  freeBudgetBytes: () => Promise<number>;
  version: string;
};

export type StatusReport = {
  version: string;
  ollama: boolean;
  loaded: string[];
  freeGb: number;
};

export async function collectStatus(deps: StatusDeps): Promise<StatusReport> {
  const [ollama, loaded, free] = await Promise.all([
    deps.ollamaReachable(),
    deps.loadedModels(),
    deps.freeBudgetBytes(),
  ]);
  return {
    version: deps.version,
    ollama,
    loaded,
    freeGb: Math.round(free / 1e9),
  };
}

export function renderStatus(r: StatusReport): string {
  return [
    `agent-framework ${r.version}`,
    `ollama:  ${r.ollama ? 'reachable' : 'DOWN'}`,
    `models:  ${r.loaded.length ? r.loaded.join(', ') : '(none resident)'}`,
    `budget:  ~${r.freeGb} GB free`,
  ].join('\n');
}

/** Ping Ollama's /api/version directly — never throws, degrades to `false`. */
async function pingOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/version`, {
      signal: AbortSignal.timeout(probeTimeoutMs()),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** List Ollama's resident model names — never throws, degrades to `[]`. */
async function listOllamaLoadedModelNames(): Promise<string[]> {
  try {
    const loaded = await runtimeFor(RuntimeKind.Ollama).control.listLoaded();
    return loaded.map((m) => m.name);
  } catch {
    return [];
  }
}

/** The live free-memory budget — never throws, degrades to `0`. */
async function safeLiveBudgetBytes(): Promise<number> {
  try {
    return await liveBudgetBytes();
  } catch {
    return 0;
  }
}

/** Build the real deps `main()` uses — each probe degrades instead of throwing. */
function makeRealDeps(): StatusDeps {
  return {
    ollamaReachable: pingOllamaReachable,
    loadedModels: listOllamaLoadedModelNames,
    freeBudgetBytes: safeLiveBudgetBytes,
    version: APP_VERSION,
  };
}

async function main(): Promise<void> {
  const report = await collectStatus(makeRealDeps());
  process.stdout.write(`${renderStatus(report)}\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
