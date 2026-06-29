import { createSuperAgent } from '../../agents/super.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import { runChat } from './run-chat.ts';

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim();
  if (task.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<your request>"');
    process.exit(1);
  }

  const manager = createModelManager();
  // Warm + pin the small router model the orchestrator runs on.
  console.error(`Preparing router model ${qwenRouter.model}...`);
  await manager.ensureReady(qwenRouter, { pinned: [qwenRouter.model] });
  console.error(
    isProjectStoreActive()
      ? 'Using project-local models from ./model-images'
      : '⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.',
  );

  // Specialists' models are loaded on demand, keeping the router pinned-resident.
  const onBeforeDelegate = (agent: {
    modelDecl?: import('../core/types.ts').ModelDeclaration;
  }) =>
    agent.modelDecl
      ? manager.ensureReady(agent.modelDecl, { pinned: [qwenRouter.model] })
      : Promise.resolve();

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
      });
      console.log(result.kind === 'answer' ? result.text : result.message);
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
