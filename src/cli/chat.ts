import { createSuperAgent } from '../../agents/super.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { ResourceError } from '../core/errors.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget, machineBudgetBytes } from '../resource/hardware.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import {
  isModelInstalled,
  pullModel,
  unloadModel,
  warmModel,
} from '../resource/ollama-control.ts';
import { runChat } from './run-chat.ts';

const FOOTPRINT = estimateModelBytes({
  paramsBillions: 8,
  bytesPerWeight: 0.56,
  contextTokens: qwenFast.params.numCtx ?? 8192,
  kvBytesPerToken: 131072,
});

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim();
  if (task.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<your request>"');
    process.exit(1);
  }

  const budget = machineBudgetBytes();
  if (!fitsBudget(FOOTPRINT, budget)) {
    throw new ResourceError(
      `${qwenFast.model} (~${Math.round(FOOTPRINT / 1e9)}GB) exceeds the GPU budget (~${Math.round(budget / 1e9)}GB)`,
    );
  }

  if (!(await isModelInstalled(qwenFast.model))) {
    console.error(`Pulling ${qwenFast.model} (first run only)...`);
    await pullModel(qwenFast.model);
  }
  await warmModel(qwenFast.model);
  console.error(
    isProjectStoreActive()
      ? 'Using project-local models from ./model-images'
      : '⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.',
  );

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const orchestrator = createSuperAgent(
        fileServer.tools,
        fetchServer.tools,
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
    await unloadModel(qwenFast.model);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
