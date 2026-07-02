import { generateObject, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { agentNames } from '../../agents/index.ts';
import { ollamaCtxOptions } from '../core/agent-def.ts';
import { Capability, PreferPolicy } from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { defaultConfigPath } from '../mcp/config.ts';
import { STARTER_PACK } from '../mcp/pack.ts';
import { askYesNo, stdinInput } from '../provisioning/ui/prompt.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { listLoadedModels } from '../resource/ollama-control.ts';
import { resolveModel } from '../resource/selector.ts';
import { runtimeFor } from '../runtime/registry.ts';
import type { BuilderDeps, BuilderModel } from './types.ts';

type GenerateObjectFn = typeof generateObject;

/** Wrap a live model as the structured-generation seam. `generateImpl` is
 *  injectable for tests; defaults to the AI SDK's generateObject. */
export function makeBuilderModel(
  model: LanguageModel,
  numCtx?: number,
  generateImpl: GenerateObjectFn = generateObject,
): BuilderModel {
  const providerOptions = numCtx ? ollamaCtxOptions(numCtx) : undefined;
  return {
    object: async <T>(args: {
      schema: z.ZodType<T>;
      prompt: string;
    }): Promise<T> => {
      const { object } = await generateImpl({
        model,
        schema: args.schema,
        prompt: args.prompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      return object as T;
    },
  };
}

/** Assemble live builder deps: a tools-capable largest-that-fits model, the
 *  pack palette, the existing-agent names, a TTY consent prompt, and default fs
 *  paths. Returns a cleanup that unloads the model. */
export async function makeRealBuilderDeps(
  opts: { autoYes?: boolean } = {},
): Promise<{ deps: BuilderDeps; cleanup: () => Promise<void> }> {
  const manager = createModelManager();
  const registry = await buildRegistry();
  const { decl, numCtx } = await resolveModel(
    {
      role: 'agent builder',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
    registry,
    {
      ensureReady: (d, o) => manager.ensureReady(d, o),
      listLoaded: () => listLoadedModels(),
    },
  );
  const model = runtimeFor(decl.provider).createModel(decl);
  const input = stdinInput();
  const deps: BuilderDeps = {
    model: makeBuilderModel(model, numCtx),
    existingNames: () => agentNames(),
    packNames: () => STARTER_PACK.map((e) => e.name),
    confirm: (text) => {
      process.stderr.write(`${text}\n`);
      return askYesNo('Create this agent?', {
        input,
        autoYes: opts.autoYes === true,
      });
    },
    paths: {
      agentsDir: 'agents',
      indexPath: 'agents/index.ts',
      mcpConfigPath: defaultConfigPath(),
    },
    log: (m) => console.error(m),
  };
  return { deps, cleanup: () => manager.unloadAll() };
}
