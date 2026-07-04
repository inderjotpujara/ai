import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
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

type GenerateTextFn = typeof generateText;

/** Strip a ```json fence (if present) and slice from the first `{` to the
 *  last `}`, mirroring `src/verification/claims.ts`'s `extractJson`. Local
 *  models often wrap JSON in commentary or markdown fences. */
function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : raw)?.trim() ?? raw.trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** Parse `raw` as JSON and validate it against `schema`; throws on either
 *  failure so the caller can decide whether to retry. */
function parseAgainst<T>(raw: string, schema: z.ZodType<T>): T {
  const parsed: unknown = JSON.parse(extractJson(raw));
  return schema.parse(parsed);
}

/** Wrap a live model as the structured-generation seam. `generateTextImpl`
 *  is injectable for tests; defaults to the AI SDK's generateText.
 *
 *  Local Ollama models (e.g. qwen3.5:9b) don't reliably honor the AI SDK's
 *  provider-native structured-output/JSON mode (`generateObject`) — they can
 *  return free-form YAML-ish `key: value` text instead of JSON using the
 *  schema's keys. The repo's proven pattern for structured extraction from
 *  local models is generateText + JSON extraction + parse (see
 *  `src/verification/claims.ts` + `src/verification/deps.ts`), so this seam
 *  follows the same shape: prompt for strict JSON, extract, parse with zod,
 *  and retry once with a stricter reminder before giving up. */
export function makeBuilderModel(
  model: LanguageModel,
  numCtx?: number,
  generateTextImpl: GenerateTextFn = generateText,
): BuilderModel {
  const providerOptions = numCtx ? ollamaCtxOptions(numCtx) : undefined;
  return {
    object: async <T>(args: {
      schema: z.ZodType<T>;
      prompt: string;
    }): Promise<T> => {
      const keys =
        args.schema instanceof z.ZodObject
          ? Object.keys(args.schema.shape)
          : [];
      const keyHint =
        keys.length > 0
          ? ` using EXACTLY these keys: ${keys.join(', ')}.`
          : '.';
      const basePrompt = `${args.prompt}\n\nRespond with ONLY a JSON object (no markdown fences, no commentary)${keyHint}`;

      const first = await generateTextImpl({
        model,
        prompt: basePrompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      try {
        return parseAgainst(first.text, args.schema);
      } catch {
        // fall through to the retry below
      }

      const retryPrompt = `${basePrompt}\n\nThe previous response was not valid JSON. Return ONLY the JSON object, nothing else.`;
      const second = await generateTextImpl({
        model,
        prompt: retryPrompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      try {
        return parseAgainst(second.text, args.schema);
      } catch {
        throw new Error(
          'agent-builder: model did not return valid JSON for the proposal',
        );
      }
    },
    text: async (args: { prompt: string }): Promise<string> => {
      const r = await generateTextImpl({
        model,
        prompt: args.prompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      return r.text;
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
  const model = runtimeFor(decl.runtime).createModel(decl);
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
