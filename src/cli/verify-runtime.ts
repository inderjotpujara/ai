import qwenRouter from '../../models/qwen-router.ts';
import { RuntimeKind } from '../core/types.ts';
import { makeEmbedder, probeEmbedder } from '../memory/embed.ts';
import { makeCrossEncoderReranker } from '../memory/reranker.ts';
import { createMemoryStore, type MemoryStore } from '../memory/store.ts';
import type { MemoryConfig } from '../memory/types.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { makeVerifyDeps } from '../verification/deps.ts';
import type { VerifyDeps } from '../verification/types.ts';

/** Build the real, Ollama/Model-Manager-backed VerifyDeps + the memory store +
 *  manager they're wired against, so the CLI can also close them cleanly on
 *  shutdown. Mirrors `makeRealStore` in src/cli/memory.ts (the embedder/store
 *  construction is identical; this additionally wraps it in VerifyDeps). */
export function makeRealVerifyDeps(): {
  verifyDeps: VerifyDeps;
  store: MemoryStore;
  manager: ReturnType<typeof createModelManager>;
} {
  const manager = createModelManager();
  const control = runtimeFor(RuntimeKind.Ollama).control;
  const embedModel =
    process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
  const embedder = makeEmbedder({
    ensureReady: (decl) => manager.ensureReady(decl),
    control,
    model: embedModel,
  });
  const config: MemoryConfig = { embedModel };
  const store = createMemoryStore(config, {
    embedTexts: embedder.embed,
    embedQuery: async (text) => (await embedder.embed([text]))[0] as number[],
    probe: probeEmbedder,
    reranker: makeCrossEncoderReranker(),
  });
  const verifyDeps = makeVerifyDeps({
    manager,
    control,
    generalModel: qwenRouter.model,
    store,
    space: 'default',
  });
  return { verifyDeps, store, manager };
}
