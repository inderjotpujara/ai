import qwenFast from '../../models/qwen-fast.ts';
import { ResourceError } from '../core/errors.ts';
import { createFileTools } from '../mcp/client.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget, machineBudgetBytes } from '../resource/hardware.ts';
import {
  isModelInstalled,
  pullModel,
  unloadModel,
  warmModel,
} from '../resource/ollama-control.ts';
import { answerFileQuestion } from './answer-file-question.ts';

// qwen3:8b @ Q4_K_M, 8k context — rough footprint for the budget check.
const FOOTPRINT = estimateModelBytes({
  paramsBillions: 8,
  bytesPerWeight: 0.56,
  contextTokens: qwenFast.params.numCtx ?? 8192,
  kvBytesPerToken: 131072,
});

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(' ').trim();
  if (question.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<question about a file>"');
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

  const model = createOllamaModel(qwenFast);
  const { tools, close } = await createFileTools();
  try {
    const answer = await answerFileQuestion({
      model,
      tools,
      question,
      runsRoot: 'runs',
      runId: `run-${process.pid}`,
    });
    console.log(answer);
  } finally {
    await close();
    await unloadModel(qwenFast.model);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
