import { createInterface } from 'node:readline';
import { generateText } from 'ai';
import { ProviderKind } from '../core/types.ts';
import type { MemoryStore } from '../memory/store.ts';
import type { RetrievalResult } from '../memory/types.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import type { createModelManager } from '../resource/model-manager.ts';
import type { RuntimeControl } from '../runtime/runtime.ts';
import { autoPullPolicy } from './config.ts';
import type { VerifyDeps } from './types.ts';

export type MakeVerifyDepsArgs = {
  manager: Pick<ReturnType<typeof createModelManager>, 'ensureReady'>;
  control: RuntimeControl;
  generalModel: string;
  store: Pick<MemoryStore, 'getByIds'>;
  space: string;
};

/** Weights-only-ish chat declaration for a judge/general model run through
 *  verify's `generate`. Mirrors the shape of the project's chat model
 *  declarations (models/qwen-*.ts); a conservative context is enough for the
 *  short claim-check/decompose/grade prompts verify issues. */
function chatDecl(model: string) {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { temperature: 0.1, numCtx: 8192 },
    role: 'verification judge / general',
    footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
  };
}

/** Ask the user on stdin whether to pull a model; resolves false on any
 *  non-affirmative answer (including EOF/blank). */
function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

/** Build the real, Ollama/Model-Manager-backed VerifyDeps. Kept behind this
 *  factory so unit tests never need a running Ollama instance: they construct
 *  a fake `control`/`manager`/`store` and exercise `ensureJudge`/`getByIds`
 *  directly. `generate` (the only method that actually talks to Ollama) is
 *  exercised only by real CLI runs. */
export function makeVerifyDeps(args: MakeVerifyDepsArgs): VerifyDeps {
  const { manager, control, generalModel, store } = args;

  async function generate(model: string, prompt: string): Promise<string> {
    const decl = chatDecl(model);
    await manager.ensureReady(decl);
    const result = await generateText({
      model: createOllamaModel(decl),
      prompt,
    });
    return result.text;
  }

  async function getByIds(
    forSpace: string,
    ids: string[],
  ): Promise<RetrievalResult[]> {
    return store.getByIds(forSpace, ids);
  }

  async function ensureJudge(
    model: string,
  ): Promise<{ model: string; fallback: boolean }> {
    if (await control.isInstalled(model)) return { model, fallback: false };

    const policy = autoPullPolicy();
    if (policy === 'always') {
      await control.pull(model);
      return { model, fallback: false };
    }

    if (policy === 'prompt' && process.stdin.isTTY) {
      const yes = await askYesNo(`pull ${model}? [y/N] `);
      if (yes) {
        await control.pull(model);
        return { model, fallback: false };
      }
    }

    console.error(
      `[verify] judge model "${model}" not installed; falling back to "${generalModel}" for grading.`,
    );
    return { model: generalModel, fallback: true };
  }

  return { generate, getByIds, ensureJudge, generalModel };
}
