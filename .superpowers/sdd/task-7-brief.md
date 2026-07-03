## Task 7: real deps + `bun run agent-builder` CLI + chat gap-offer

**Files:**
- Create: `src/agent-builder/deps.ts`, `src/cli/agent-builder.ts`
- Modify: `src/cli/chat.ts` (gap branch), `package.json` (script)
- Test: `tests/agent-builder/deps.test.ts` (light — arg/usage + non-TTY behavior)

**Interfaces:**
- Consumes: `buildAgent`, `BuilderDeps` (Task 6); model-acquire recipe; `interactiveTTY`/`askYesNo`/`stdinInput`; `agentNames`; `STARTER_PACK`.
- Produces:
  ```ts
  // deps.ts
  export function makeBuilderModel(model: LanguageModel, numCtx?: number): BuilderModel;
  export async function makeRealBuilderDeps(opts?: { autoYes?: boolean }): Promise<{ deps: BuilderDeps; cleanup: () => Promise<void> }>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/agent-builder/deps.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { makeBuilderModel } from '../../src/agent-builder/deps.ts';

describe('makeBuilderModel', () => {
  it('wraps a generateObject-shaped call and returns the object', async () => {
    // fake LanguageModel is never actually called: we inject the generate fn
    const fakeGenerate = async () => ({ object: { servers: ['fetch'] } });
    const model = makeBuilderModel({} as never, 8192, fakeGenerate as never);
    const out = await model.object({ schema: z.object({ servers: z.array(z.string()) }), prompt: 'x' });
    expect(out).toEqual({ servers: ['fetch'] });
  });
});
```

> Note: `makeBuilderModel(model, numCtx, generateImpl?)` takes an optional third arg defaulting to the AI SDK's `generateObject`, so the wrapper is testable without a live model.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent-builder/deps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/agent-builder/deps.ts`**

```typescript
import { type LanguageModel, generateObject } from 'ai';
import type { z } from 'zod';
import { agentNames } from '../../agents/index.ts';
import { ollamaCtxOptions } from '../core/agent-def.ts';
import { Capability, PreferPolicy } from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { defaultConfigPath } from '../mcp/config.ts';
import { STARTER_PACK } from '../mcp/pack.ts';
import { askYesNo, interactiveTTY, stdinInput } from '../provisioning/ui/prompt.ts';
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
    object: async <T>(args: { schema: z.ZodType<T>; prompt: string }): Promise<T> => {
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
    { role: 'agent builder', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
    registry,
    { ensureReady: (d, o) => manager.ensureReady(d, o), listLoaded: () => listLoadedModels() },
  );
  const model = runtimeFor(decl.provider).createModel(decl);
  const input = stdinInput();
  const deps: BuilderDeps = {
    model: makeBuilderModel(model, numCtx),
    existingNames: () => agentNames(),
    packNames: () => STARTER_PACK.map((e) => e.name),
    confirm: (text) => {
      process.stderr.write(`${text}\n`);
      return askYesNo('Create this agent?', { input, autoYes: opts.autoYes === true && !interactiveTTY() ? false : opts.autoYes === true });
    },
    paths: { agentsDir: 'agents', indexPath: 'agents/index.ts', mcpConfigPath: defaultConfigPath() },
    log: (m) => console.error(m),
  };
  return { deps, cleanup: () => manager.unloadAll() };
}
```

> `askYesNo` already honors `autoYes`; the `interactiveTTY()` guard means `--yes` only bypasses the prompt in a real TTY-less/automation context is NOT required — pass `autoYes` straight through. Simplify the `confirm` autoYes expression to `askYesNo('Create this agent?', { input, autoYes: opts.autoYes === true })` if the reviewer prefers; behavior for tests is driven by the explicit `--yes` flag in the CLI.

- [ ] **Step 4: Create `src/cli/agent-builder.ts`**

```typescript
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';

function parseArgs(argv: string[]): { need: string; autoYes: boolean } {
  const positional: string[] = [];
  let autoYes = false;
  for (const a of argv) {
    if (a === '--yes' || a === '-y') autoYes = true;
    else positional.push(a);
  }
  return { need: positional.join(' ').trim(), autoYes };
}

async function main(): Promise<void> {
  const { need, autoYes } = parseArgs(process.argv.slice(2));
  if (need.length === 0) {
    console.error('Usage: bun run agent-builder "<capability you need>" [--yes]');
    process.exit(1);
  }
  const { deps, cleanup } = await makeRealBuilderDeps({ autoYes });
  try {
    const result = await buildAgent(need, deps);
    if (result.kind === 'written') {
      console.log(`Created agent "${result.proposal.name}". Files: ${result.files.join(', ')}`);
      console.log('It is live on your next run. Its MCP server (if any) is consent-gated on first mount.');
    } else if (result.kind === 'declined') {
      console.error('Declined — nothing written.');
    } else if (result.kind === 'invalid') {
      console.error('Could not build a valid agent:');
      for (const i of result.issues) console.error(`  - ${i.field}: ${i.problem}`);
      process.exitCode = 1;
    } else {
      console.error(`Abandoned: ${result.reason}`);
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Wire the chat gap-offer in `src/cli/chat.ts`**

At the gap branch (currently `else if (result.kind === 'gap') { console.log(result.message); }` inside the `withMcpRun` body), replace with a TTY-gated offer. Add imports at the top of `chat.ts`:

```typescript
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import { askYesNo, interactiveTTY, stdinInput } from '../provisioning/ui/prompt.ts';
```

Replace the gap branch body with:

```typescript
      } else if (result.kind === 'gap') {
        console.log(result.message);
        if (interactiveTTY()) {
          const wants = await askYesNo(
            `Propose a new agent for "${result.missingCapability}"?`,
            { input: stdinInput(), autoYes: false },
          );
          if (wants) {
            const { deps, cleanup } = await makeRealBuilderDeps();
            try {
              const built = await buildAgent(`${result.missingCapability}. Original task: ${task}`, deps);
              if (built.kind === 'written') {
                console.log(`Created "${built.proposal.name}" — re-run your task to use it.`);
              }
            } finally {
              await cleanup();
            }
          }
        }
```

(Keep the existing `resource`/`answer` branches unchanged. Non-TTY: unchanged — only `console.log(result.message)` runs.)

- [ ] **Step 6: Add the package.json script**

In `package.json` `scripts`, after `"mcp": ...`, add:

```json
    "agent-builder": "bun run src/cli/agent-builder.ts"
```

- [ ] **Step 7: Run tests + typecheck + lint**

Run: `bun test tests/agent-builder/deps.test.ts` (PASS); `bun run typecheck` (clean); `bun run lint:file -- "src/agent-builder/deps.ts" "src/cli/agent-builder.ts" "src/cli/chat.ts" "tests/agent-builder/deps.test.ts"`.

- [ ] **Step 8: Commit**

```bash
git add src/agent-builder/deps.ts src/cli/agent-builder.ts src/cli/chat.ts package.json tests/agent-builder/deps.test.ts
git commit -m "feat(agent-builder): real deps + bun run agent-builder CLI + TTY gap-offer in chat (Slice 17 Task 7)"
```

---

