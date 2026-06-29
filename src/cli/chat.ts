import { createSuperAgent } from '../../agents/super.ts';
import qwenRouter from '../../models/qwen-router.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import { createModelManager, MIN_CTX } from '../resource/model-manager.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import {
  isModelInstalled,
  listLoadedModels,
} from '../resource/ollama-control.ts';
import { runChat } from './run-chat.ts';
import { createSelectHook } from './select-hook.ts';
import { formatSelectionNotice } from './selection-notice.ts';

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim();
  if (task.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<your request>"');
    process.exit(1);
  }

  const manager = createModelManager();
  // Warm + pin the small router model the orchestrator runs on.
  console.error(`Preparing router model ${qwenRouter.model}...`);
  const routerNumCtx = await manager.ensureReady(qwenRouter, {
    pinned: [qwenRouter.model],
  });
  console.error(
    isProjectStoreActive()
      ? 'Using project-local models from ./model-images'
      : '⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.',
  );

  // Capture seam: a genuine no-fit during delegation is recorded here and surfaced
  // by runOrchestrator as kind:'resource' instead of being swallowed.
  const capture: ResourceCapture = {};

  // Announce each NEW model decision (size, context, footprint, install state) once.
  const announced = new Set<string>();
  const notify = async (decl: ModelDeclaration): Promise<void> => {
    if (announced.has(decl.model)) return;
    announced.add(decl.model);
    const [installed, budget] = await Promise.all([
      isModelInstalled(decl.model),
      liveBudgetBytes(),
    ]);
    console.error(
      formatSelectionNotice({
        decl,
        numCtx: decl.params.numCtx ?? MIN_CTX,
        budgetBytes: budget,
        installed,
      }),
    );
  };

  const registry = await buildRegistry();
  const onBeforeDelegate = createSelectHook({
    registry,
    ensureReady: (decl, opts) => manager.ensureReady(decl, opts),
    listLoaded: () => listLoadedModels(),
    pinned: [qwenRouter.model],
    capture,
    onAttempt: notify,
  });

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const orchestrator = createSuperAgent(
        fileServer.tools,
        fetchServer.tools,
        onBeforeDelegate,
      );
      const result = await runChat({
        orchestrator,
        task,
        runsRoot: 'runs',
        runId: `run-${process.pid}`,
        routerNumCtx,
        capture,
      });
      if (result.kind === 'answer') {
        console.log(result.text);
      } else if (result.kind === 'gap') {
        console.log(result.message);
      } else {
        console.error(result.message);
        process.exitCode = 1;
      }
    } finally {
      await fetchServer.close();
    }
  } finally {
    await fileServer.close();
    await manager.unloadAll();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
