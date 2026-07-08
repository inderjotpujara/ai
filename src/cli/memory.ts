import { RuntimeKind } from '../core/types.ts';
import { makeEmbedder, probeEmbedder } from '../memory/embed.ts';
import { makeCrossEncoderReranker } from '../memory/reranker.ts';
import { createMemoryStore, type MemoryStore } from '../memory/store.ts';
import type { MemoryConfig } from '../memory/types.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { createRun } from '../run/run-store.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { withRunContext } from '../telemetry/run-router.ts';

export type MemoryCliDeps = {
  makeStore: () => MemoryStore;
};

type Flags = {
  space?: string;
  ns?: string;
  top?: number;
  embed?: string;
};

/** Parse `--flag value` pairs out of the positional args, returning the rest. */
function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--space') {
      flags.space = argv[++i];
    } else if (arg === '--ns') {
      flags.ns = argv[++i];
    } else if (arg === '--top') {
      const v = argv[++i];
      if (v !== undefined) flags.top = Number(v);
    } else if (arg === '--embed') {
      flags.embed = argv[++i];
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** Build the real, manager-backed memory store (Ollama embedder via the model manager).
 * Returns both the store and a manager instance for lifecycle management.
 */
function makeRealStore(flags: Flags): {
  store: MemoryStore;
  manager: ReturnType<typeof createModelManager>;
} {
  const manager = createModelManager();
  const control = runtimeFor(RuntimeKind.Ollama).control;
  const model =
    flags.embed ??
    process.env.AGENT_MEMORY_EMBED_MODEL ??
    'qwen3-embedding:0.6b';
  const embedder = makeEmbedder({
    ensureReady: (decl) => manager.ensureReady(decl),
    control,
    model,
  });
  const config: MemoryConfig = { embedModel: model };
  // Cross-encoder rerank spike (Task 13) PASSED under Bun on Apple Silicon, so
  // it's wired as the default reranker here; `defaultRerank()` in retrieve.ts
  // still gates actual use behind AGENT_MEMORY_RERANK (default on, '0' = off).
  // transformers.js manages its own model weights cache — NOT the Ollama Model
  // Manager used for the chat/embed models above.
  const store = createMemoryStore(config, {
    embedTexts: embedder.embed,
    embedQuery: async (text) => (await embedder.embed([text]))[0] as number[],
    probe: probeEmbedder,
    reranker: makeCrossEncoderReranker(),
  });
  return { store, manager };
}

function usage(): string {
  return [
    'Usage: bun run memory <command> [args] [--space s] [--ns n] [--top k] [--embed model]',
    '  ingest <path>   embed + store a file',
    '  recall <query>  retrieve relevant chunks',
    '  stats           print chunk counts per space',
    '  reindex <space> <newEmbedModel>  rebuild a space under a new embedder',
  ].join('\n');
}

/** Route a memory subcommand to the store. Exit-code-returning so it's unit-testable. */
export async function runMemoryCli(
  argv: string[],
  deps: MemoryCliDeps,
): Promise<number> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);
  const store = deps.makeStore();
  try {
    switch (command) {
      case 'ingest': {
        const path = positional[0];
        if (!path) {
          console.error(
            'Usage: bun run memory ingest <path> [--space s] [--ns n]',
          );
          return 1;
        }
        const result = await store.ingest(path, {
          space: flags.space,
          namespace: flags.ns,
          at: Date.now(),
        });
        console.log(
          result.skipped
            ? `skipped (unchanged): ${path}`
            : `ingested ${result.chunks} chunk(s) from ${path}`,
        );
        return 0;
      }
      case 'recall': {
        const query = positional.join(' ').trim();
        if (!query) {
          console.error(
            'Usage: bun run memory recall <query> [--space s] [--ns n] [--top k]',
          );
          return 1;
        }
        const results = await store.recall(query, {
          space: flags.space,
          namespace: flags.ns,
          topK: flags.top,
        });
        console.log(JSON.stringify(results, null, 2));
        return 0;
      }
      case 'stats': {
        const stats = await store.stats();
        console.log(JSON.stringify(stats, null, 2));
        return 0;
      }
      case 'reindex': {
        const [space, newEmbedModel] = positional;
        if (!space || !newEmbedModel) {
          console.error(
            'Usage: bun run memory reindex <space> <newEmbedModel>',
          );
          return 1;
        }
        await store.reindex(space, newEmbedModel);
        console.log(`reindexed ${space} -> ${newEmbedModel}`);
        return 0;
      }
      default: {
        console.error(`Unknown command: ${command ?? '(none)'}\n\n${usage()}`);
        return 1;
      }
    }
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { flags } = parseFlags(argv.slice(1));
  const run = await createRun('runs', `memory-${process.pid}`);
  const tel = initRunTelemetry(run.dir, run.id);
  let storeAndManager:
    | { store: MemoryStore; manager: ReturnType<typeof createModelManager> }
    | undefined;
  try {
    const code = await withRunContext(run.id, () =>
      runMemoryCli(argv, {
        makeStore: () => {
          storeAndManager = makeRealStore(flags);
          return storeAndManager.store;
        },
      }),
    );
    process.exitCode = code;
  } finally {
    if (storeAndManager) {
      await storeAndManager.manager.unloadAll();
    }
    await tel.shutdown();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
