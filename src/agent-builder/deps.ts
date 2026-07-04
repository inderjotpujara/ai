import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { agentNames } from '../../agents/index.ts';
import { ollamaCtxOptions } from '../core/agent-def.ts';
import { runGuardedAgent } from '../core/delegate.ts';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
  RuntimeKind,
} from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { defaultConfigPath } from '../mcp/config.ts';
import { STARTER_PACK } from '../mcp/pack.ts';
import { makeEmbedder } from '../memory/embed.ts';
import { askYesNo, stdinInput } from '../provisioning/ui/prompt.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { listLoadedModels } from '../resource/ollama-control.ts';
import { resolveModel } from '../resource/selector.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { dryRunMs } from '../verified-build/config.ts';
import type { JudgeCandidate } from '../verified-build/judge.ts';
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

/** Drop a trailing comma before a closing `}`/`]` — local models frequently
 *  emit one (e.g. after the last property in an object), which is invalid
 *  strict JSON that `JSON.parse` rejects outright (found live via the
 *  crew-builder's IR generation, Slice 19 Task 19). */
function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1');
}

/** Recursively drop `null`-valued object keys. Every optional field in the
 *  schemas passed through this seam is `z.T().optional()`, not `.nullable()`
 *  — but local models routinely emit `null` for a field they mean to leave
 *  unset (e.g. `"agentRef": null`) rather than omitting the key, which zod's
 *  `.optional()` rejects. Treating `null` as "absent" is safe here because
 *  none of these schemas assign meaning to a literal `null`. */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = dropNulls(v);
    }
    return out;
  }
  return value;
}

/** Parse `raw` as JSON and validate it against `schema`; throws on either
 *  failure so the caller can decide whether to retry. */
function parseAgainst<T>(raw: string, schema: z.ZodType<T>): T {
  const parsed: unknown = dropNulls(
    JSON.parse(stripTrailingCommas(extractJson(raw))),
  );
  return schema.parse(parsed);
}

function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  return schema instanceof z.ZodOptional
    ? (schema.unwrap() as z.ZodTypeAny)
    : schema;
}

/** If `schema` is a `z.literal(...)` of a single string value, return it. */
function literalStringValue(schema: z.ZodTypeAny): string | undefined {
  if (!(schema instanceof z.ZodLiteral)) return undefined;
  const v: unknown = schema.value;
  return typeof v === 'string' ? v : undefined;
}

/** Render one discriminated-union variant's object shape, one level deep,
 *  spelling out the discriminator field's literal value (e.g. `"kind":
 *  "agent"`) so the model sees which variant is which, and `...` for every
 *  other key — mirrors the plain-object-array case below. */
function describeVariantShape(
  variant: z.ZodTypeAny,
  discriminator: string,
): string {
  if (!(variant instanceof z.ZodObject)) return '{...}';
  const shape = variant.shape as Record<string, z.ZodTypeAny>;
  const fields = Object.entries(shape).map(([key, value]) => {
    if (key !== discriminator) return `"${key}": ...`;
    const lit = literalStringValue(unwrapOptional(value));
    return `"${key}": ${lit !== undefined ? `"${lit}"` : '...'}`;
  });
  return `{${fields.join(', ')}}`;
}

/** Render a `z.discriminatedUnion(...)`'s variants for the shape hint, e.g.
 *  `{"kind": "agent", ...} | {"kind": "tool", ...}`. */
function describeDiscriminatedUnion(du: z.ZodDiscriminatedUnion): string {
  const { discriminator, options } = du.def;
  return options
    .map((o) => describeVariantShape(o as z.ZodTypeAny, discriminator))
    .join(' | ');
}

/** Describe a top-level ZodObject's shape for the structured-JSON prompt.
 *  A bare key-name list (`"using EXACTLY these keys: members"`) is enough
 *  for flat schemas (every field agent-builder's `DraftSchema` uses is a
 *  string), but under-specifies a field typed as an array-of-objects: local
 *  models (e.g. qwen3.5:9b) resolve the ambiguity by collapsing each element
 *  to a bare string — `{"members":["Researcher","Writer"]}` — instead of an
 *  object matching the element schema (found live via the crew-builder's
 *  `CrewNodes`/`CrewIRSchema`, both `{ members: MemberNode[] }`-shaped; see
 *  Slice 19 Task 19). So for any field whose type is `array(object)`, spell
 *  out the inner object's keys as a literal shape example, one level deep —
 *  sufficient for every schema this seam currently serializes. Array
 *  elements typed as a `z.discriminatedUnion(...)` (e.g. `WorkflowIRSchema`'s
 *  `steps: (AgentStepIR | ToolStepIR | BranchStepIR | MapStepIR)[]`) get the
 *  same one-level-deep treatment per variant instead of falling through to
 *  the plain-value case, which used to render the misleading
 *  `["<string>", ...]` — the model then had no signal that each step is an
 *  object shaped by its `kind` (found in review, Slice 19 close-review). */
export function describeSchemaShape(schema: z.ZodTypeAny): string {
  if (!(schema instanceof z.ZodObject)) return '';
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const fields = Object.entries(shape).map(([key, value]) => {
    const unwrapped = unwrapOptional(value);
    if (unwrapped instanceof z.ZodArray) {
      const element = unwrapOptional(unwrapped.element as z.ZodTypeAny);
      if (element instanceof z.ZodObject) {
        const innerKeys = Object.keys(element.shape);
        return `"${key}": [{${innerKeys.map((k) => `"${k}": ...`).join(', ')}}]`;
      }
      if (element instanceof z.ZodDiscriminatedUnion) {
        return `"${key}": [${describeDiscriminatedUnion(element)}]`;
      }
      // Array of plain values (e.g. strings) — spell out "an array of
      // strings", not objects, to stop the model wrapping each element in
      // `{"id": "..."}` (found live via CrewIRSchema's `dependsOn: string[]`).
      return `"${key}": ["<string>", ...]`;
    }
    return `"${key}": ...`;
  });
  return `{${fields.join(', ')}}`;
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
      const shape = describeSchemaShape(args.schema as z.ZodTypeAny);
      const keyHint = shape ? ` using EXACTLY this JSON shape: ${shape}.` : '.';
      const basePrompt = `${args.prompt}\n\nRespond with ONLY a JSON object (no markdown fences, no commentary)${keyHint}`;

      const first = await generateTextImpl({
        model,
        prompt: basePrompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      let firstErrorMessage = '';
      try {
        return parseAgainst(first.text, args.schema);
      } catch (e) {
        // Feed the SPECIFIC failure back (JSON syntax error or the zod
        // issue path/message) rather than a generic "not valid JSON" —
        // mirrors generate.ts's `feedbackBlock` pattern (Slice 18 Task 24)
        // of showing the model exactly what it got wrong last time, which
        // is far more correctable than a content-free retry nudge (found
        // live: schema-shape mismatches like an empty `requires` array or a
        // wrong field type need the actual issue, not "invalid JSON", to
        // self-correct — Slice 19 Task 19).
        firstErrorMessage = e instanceof Error ? e.message : String(e);
        // fall through to the retry below
      }

      const retryPrompt = `${basePrompt}\n\nThe previous response was invalid: ${firstErrorMessage}\nReturn ONLY the corrected JSON object, nothing else.`;
      const second = await generateTextImpl({
        model,
        prompt: retryPrompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      try {
        return parseAgainst(second.text, args.schema);
      } catch (e) {
        throw new Error(
          `agent-builder: model did not return valid JSON for the proposal (${e instanceof Error ? e.message : String(e)})`,
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

/** Heuristic "model family" from its tag, e.g. "qwen3.5" from "qwen3.5:9b".
 *  The repo has no canonical model-family registry — this is only used to
 *  prefer a judge from a DIFFERENT family than the generator (selectJudge),
 *  a soft preference, not a correctness requirement. */
function modelFamily(modelName: string): string {
  return modelName.split(':')[0] ?? modelName;
}

function toJudgeCandidate(decl: ModelDeclaration): JudgeCandidate {
  return {
    model: decl.model,
    params: decl.footprint.approxParamsBillions * 1e9,
    family: modelFamily(decl.model),
  };
}

/** Assemble live builder deps: a tools-capable largest-that-fits model, the
 *  pack palette, the existing-agent names, a TTY consent prompt, and default fs
 *  paths. Returns a cleanup that unloads the model.
 *
 *  Also wires `deps.verify` (Slice 20 — the verify-then-commit gate) against
 *  the same model manager + registry: a manager-backed embedder, judge
 *  candidates from the full discovered registry, `runGuardedAgent` for the
 *  dry-run/golden-eval calls, and a yes/no judge that resolves and runs the
 *  model `selectJudge` picked (never the generator grading itself).
 *  TODO(controller): `runAgent`'s staged `Agent` currently mounts NO real MCP
 *  tools (see `agentFromProposal` in builder.ts) — a live-verify pass on an
 *  agent whose suggested servers matter will need scoped MCP clients spun up
 *  for the staged, not-yet-registered agent before this is fully faithful. */
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
  // Resolve (and cache) a LanguageModel for the judge `selectJudge` picked —
  // the judge must run on THAT model, never the generator grading itself
  // (C3). Judge ids come from this same registry, so the lookup only misses
  // if the registry changed mid-run; degrade to the builder model then
  // rather than crash the gate.
  const judgeModels = new Map<string, LanguageModel>();
  const judgeModelFor = async (id: string): Promise<LanguageModel> => {
    if (id === decl.model) return model;
    const cached = judgeModels.get(id);
    if (cached) return cached;
    const judgeDecl = registry.find((d) => d.model === id);
    if (!judgeDecl) return model;
    await manager.ensureReady(judgeDecl);
    const judgeModel = runtimeFor(judgeDecl.runtime).createModel(judgeDecl);
    judgeModels.set(id, judgeModel);
    return judgeModel;
  };
  const input = stdinInput();
  const embedModel =
    process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
  const embedder = makeEmbedder({
    ensureReady: (d) => manager.ensureReady(d),
    control: runtimeFor(RuntimeKind.Ollama).control,
    model: embedModel,
  });
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
    verify: {
      embed: embedder.embed,
      judgeCandidates: () => registry.map(toJudgeCandidate),
      runAgent: (agent, task, signal) =>
        runGuardedAgent(agent, task, undefined, signal),
      judge: async (prompt, judgeModelId) => {
        // Runs on the SELECTED judge model (C3), deterministically
        // (temperature 0, M5), and bounded like every other verify-gate
        // model call: a hung judge aborts after dryRunMs() instead of
        // hanging the build (C1).
        const r = await generateText({
          model: await judgeModelFor(judgeModelId),
          prompt,
          temperature: 0,
          abortSignal: AbortSignal.timeout(dryRunMs()),
        });
        return r.text.trim().toLowerCase().startsWith('yes');
      },
      generatorFamily: modelFamily(decl.model),
      dir: 'agents',
    },
  };
  return { deps, cleanup: () => manager.unloadAll() };
}
