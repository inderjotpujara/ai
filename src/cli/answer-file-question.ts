import type { LanguageModel, ToolSet } from 'ai';
import { runAgent } from '../core/agent.ts';
import { appendJournal } from '../run/journal.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';

const SYSTEM_PROMPT =
  'You answer questions about local files. Use the read_file tool to read any file you need, then answer concisely.';

export type AnswerDeps = {
  model: LanguageModel;
  tools: ToolSet;
  question: string;
  runsRoot: string;
  runId: string;
};

/** Orchestrate one file-Q&A run: journal, agent, artifact, journal. */
export async function answerFileQuestion(deps: AnswerDeps): Promise<string> {
  const run = await createRun(deps.runsRoot, deps.runId);
  await appendJournal(run.dir, {
    step: 'start',
    data: { question: deps.question },
  });

  const { text } = await runAgent({
    model: deps.model,
    systemPrompt: SYSTEM_PROMPT,
    prompt: deps.question,
    tools: deps.tools,
  });

  await writeArtifact(run, 'answer.txt', text);
  await appendJournal(run.dir, { step: 'answer', data: { text } });
  return text;
}
