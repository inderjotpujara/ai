## Task 7: Shared live-selection runtime + crew CLI + registry + `flow.ts` upgrade

This task delivers the crew CLI **and** wires live, hardware-aware model selection into both the crew and workflow CLIs via one shared helper — so a member/role (or a workflow agent step) is resolved to the largest-model-that-fits at delegation, per the project's live-selection principle.

**Files:**
- Create: `src/cli/select-runtime.ts` (shared select-hook builder for the flow/crew CLIs), `src/cli/crew.ts`, `crews/index.ts`, `crews/research-crew.ts`
- Modify: `src/cli/flow.ts` (build the selection runtime; thread `onBeforeDelegate` into `runFlow`'s agent steps), `package.json` (add `crew` script)
- Test: `tests/cli/crew.test.ts`, `tests/cli/select-runtime.test.ts`, `tests/integration/crew.live.test.ts`

**Interfaces:**
- Consumes: `runCrew` + `CrewDeps` (Task 6); `defineCrew` (Task 3); `CrewDef`/`CrewProcess`/`CrewOutcome` (Task 1); `createRun`/`writeArtifact` (`src/run/run-store.ts`); `initRunTelemetry` (`src/telemetry/provider.ts`); `createFileTools`/`createFetchTools` (`src/mcp/client.ts`); `createModelManager` (`src/resource/model-manager.ts`); `buildRegistry` (`src/discovery/build-registry.ts`); `createSelectHook` (`src/cli/select-hook.ts`); `isModelInstalled`/`listLoadedModels`/`getModelKvArch` (`src/resource/ollama-control.ts`); `ResourceCapture` (`src/core/resource-capture.ts`); `BeforeDelegate` (`src/core/delegate.ts`). **Study `src/cli/chat.ts` lines 30–99 first — it contains the exact manager + registry + `createSelectHook` + `notify` wiring to extract.**
- Produces:
  - `src/cli/select-runtime.ts`: `export async function createSelectionRuntime(opts?: { pinned?: string[] }): Promise<{ onBeforeDelegate: BeforeDelegate; capture: ResourceCapture; close: () => Promise<void> }>` — builds a model manager + offline registry + a `createSelectHook` (largest-that-fits, live budget) + the one-line selection `notify`; `close()` calls `manager.unloadAll()`. This is the reusable version of `chat.ts`'s inline setup (chat.ts is left as-is in this slice; deduping it is an optional follow-up).
  - `crews/index.ts`: `export const CREWS: Record<string, CrewDef>` + `export function getCrew(name: string): CrewDef | undefined`.
  - `src/cli/crew.ts`: `export async function runCrewCli(deps: { def: CrewDef; input: unknown; runsRoot: string; runId: string; tools: ToolSet; onBeforeDelegate?: BeforeDelegate; runAgentStep?: CrewDeps['runAgentStep'] }): Promise<CrewOutcome>` + a `main()` that builds the selection runtime and passes `onBeforeDelegate` in.

- [ ] **Step 0: Write the shared `src/cli/select-runtime.ts`** (extract chat.ts's selection wiring)

```typescript
import qwenRouter from '../../models/qwen-router.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import {
  effectiveKvBytesPerToken,
  f16KvBytesPerToken,
} from '../resource/kv-cache.ts';
import { createModelManager } from '../resource/model-manager.ts';
import {
  getModelKvArch,
  isModelInstalled,
  listLoadedModels,
} from '../resource/ollama-control.ts';
import { createSelectHook } from './select-hook.ts';
import { formatSelectionNotice } from './selection-notice.ts';

/** Live model-selection runtime (manager + offline registry + select-hook)
 *  shared by the flow and crew CLIs. Agent steps / crew members are resolved to
 *  the largest model that fits the live RAM budget at delegation. Mirrors the
 *  inline setup in chat.ts (kept as-is; deduping chat.ts is a follow-up). */
export async function createSelectionRuntime(opts?: {
  pinned?: string[];
}): Promise<{
  onBeforeDelegate: BeforeDelegate;
  capture: ResourceCapture;
  close: () => Promise<void>;
}> {
  const manager = createModelManager();
  const capture: ResourceCapture = {};
  const announced = new Set<string>();

  const notify = async (
    decl: ModelDeclaration,
    numCtx: number,
  ): Promise<void> => {
    if (announced.has(decl.model)) return;
    announced.add(decl.model);
    const [installed, budget, arch] = await Promise.all([
      isModelInstalled(decl.model),
      liveBudgetBytes(),
      getModelKvArch(decl.model).catch(() => undefined),
    ]);
    const f16 = arch
      ? f16KvBytesPerToken(arch)
      : (decl.footprint.kvBytesPerToken ?? 131072);
    const kvBytesPerToken = effectiveKvBytesPerToken(f16);
    console.error(
      formatSelectionNotice({
        decl,
        numCtx,
        kvBytesPerToken,
        budgetBytes: budget,
        installed,
      }),
    );
  };

  const registry = await buildRegistry();
  const onBeforeDelegate = createSelectHook({
    registry,
    ensureReady: (decl, o) => manager.ensureReady(decl, o),
    listLoaded: () => listLoadedModels(),
    pinned: opts?.pinned ?? [],
    capture,
    notify,
  });

  return { onBeforeDelegate, capture, close: () => manager.unloadAll() };
}
```

Test `tests/cli/select-runtime.test.ts` (buildRegistry is offline-safe, so this runs without Ollama):

```typescript
import { describe, expect, it } from 'bun:test';
import { createSelectionRuntime } from '../../src/cli/select-runtime.ts';

describe('createSelectionRuntime', () => {
  it('returns a select hook + capture + close', async () => {
    const rt = await createSelectionRuntime();
    expect(typeof rt.onBeforeDelegate).toBe('function');
    expect(rt.capture).toBeDefined();
    await rt.close();
  });
});
```

Run: `bun test tests/cli/select-runtime.test.ts && bun run typecheck` → PASS. (Verify the `createSelectHook` argument names against `src/cli/select-hook.ts` — match them exactly; the block above mirrors `chat.ts` lines 74–82.)

- [ ] **Step 1: Write the example `crews/research-crew.ts`**

```typescript
import { z } from 'zod';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { defineCrew } from '../src/crew/define.ts';
import { CrewProcess } from '../src/crew/types.ts';

/** A sequential research crew: researcher gathers, writer summarizes.
 *  Crew input is the topic/URL. */
export default defineCrew({
  id: 'research-crew',
  description: 'Research a topic and produce a short brief.',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'researcher',
      role: 'Research Analyst',
      goal: 'Gather accurate, relevant facts on the given topic',
      backstory: 'You are meticulous and cite what you find.',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
    {
      name: 'writer',
      role: 'Technical Writer',
      goal: 'Turn research notes into a clear 3-bullet brief',
      backstory: 'You write tight, plain summaries.',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'Research the topic given as input and produce concise notes.',
      expectedOutput: 'A short list of key facts.',
      member: 'researcher',
      output: z.string(),
    },
    {
      id: 'brief',
      description: 'Using the research notes, write a 3-bullet brief.',
      expectedOutput: 'Exactly 3 bullet points.',
      member: 'writer',
      dependsOn: ['gather'],
      output: z.string(),
    },
  ],
});
```

- [ ] **Step 2: Write the registry `crews/index.ts`**

```typescript
import type { CrewDef } from '../src/crew/types.ts';
import researchCrew from './research-crew.ts';

/** name -> crew definition (mirrors workflows/index.ts). */
export const CREWS: Record<string, CrewDef> = {
  [researchCrew.id]: researchCrew,
};

export function getCrew(name: string): CrewDef | undefined {
  return CREWS[name];
}
```

- [ ] **Step 3: Write the failing test `tests/cli/crew.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { runCrewCli } from '../../src/cli/crew.ts';
import { defineCrew } from '../../src/crew/define.ts';
import { CrewProcess, type CrewDef } from '../../src/crew/types.ts';

// A crew whose members' default model is a mock (buildCrewAgent sets a real
// default model; for the CLI test we inject a stubbed runAgentStep path by
// using a sequential crew + MockLanguageModelV3-backed agents is heavy, so we
// assert the run wiring via a crew that runs with the default agent map but a
// mock model). Simplest: use a crew and a fake tools set; the mock model
// returns a fixed string.
const mockModel = new MockLanguageModelV3({
  doGenerate: async () => ({
    content: [{ type: 'text', text: 'result text' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: undefined, reasoning: undefined },
    },
    warnings: [],
  }),
});

const crew: CrewDef = defineCrew({
  id: 'demo-crew', process: CrewProcess.Sequential,
  members: [{ name: 'a', role: 'A', goal: 'g', backstory: 'b', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits }],
  tasks: [{ id: 't1', description: 'do', expectedOutput: 'x', member: 'a', output: z.string() }],
});

describe('runCrewCli', () => {
  it('writes spans.jsonl with crew.run + result.txt on success', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'crew-'));
    const outcome = await runCrewCli({
      def: crew, input: 'hello', runsRoot, runId: 'r1', tools: {},
      // deps hook: override the agent runner so no real model is needed
      // (runCrewCli accepts an optional runAgentStep for tests)
      runAgentStep: async () => 'result text',
    } as never);
    expect(outcome.kind).toBe('done');
    const spans = await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8');
    expect(spans).toContain('crew.run');
    const result = await readFile(join(runsRoot, 'r1', 'result.txt'), 'utf8');
    expect(result).toContain('result text');
  });
});
```

(Implementation note for Step 5: give `runCrewCli` an optional `runAgentStep?` field on its deps so this unit test can bypass a real model, mirroring how `runFlow`/`runWorkflow` accept injected deps. `mockModel` above is imported for parity with the flow test; if unused in the final wiring, drop the import to keep lint clean.)

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/cli/crew.test.ts`
Expected: FAIL — `runCrewCli` not defined.

- [ ] **Step 5: Write `src/cli/crew.ts`**

```typescript
import type { ToolSet } from 'ai';
import { getCrew } from '../../crews/index.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { runCrew, type CrewDeps } from '../crew/engine.ts';
import type { CrewDef, CrewOutcome } from '../crew/types.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { createSelectionRuntime } from './select-runtime.ts';

export type CrewCliDeps = {
  def: CrewDef;
  input: unknown;
  runsRoot: string;
  runId: string;
  tools: ToolSet;
  onBeforeDelegate?: CrewDeps['onBeforeDelegate']; // live model selection
  runAgentStep?: CrewDeps['runAgentStep']; // test seam
};

/** Run a crew with telemetry + artifact persistence (mirrors runFlow). */
export async function runCrewCli(deps: CrewCliDeps): Promise<CrewOutcome> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    const outcome = await runCrew(deps.def, deps.input, {
      tools: deps.tools,
      onBeforeDelegate: deps.onBeforeDelegate,
      runAgentStep: deps.runAgentStep,
    });
    if (outcome.kind === 'done') {
      const text =
        typeof outcome.output === 'string'
          ? outcome.output
          : JSON.stringify(outcome.output, null, 2);
      await writeArtifact(run, 'result.txt', text);
    } else {
      await writeArtifact(
        run,
        'failed.txt',
        `task ${outcome.failedTask ?? '?'}: ${outcome.message}`,
      );
    }
    return outcome;
  } finally {
    await tel.shutdown();
  }
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: bun run crew <name> [input...]');
    process.exit(1);
  }
  const def = getCrew(name);
  if (!def) {
    console.error(`Unknown crew: ${name}`);
    process.exit(1);
  }

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const selection = await createSelectionRuntime();
      try {
        const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };
        const outcome = await runCrewCli({
          def,
          input: rest.join(' ').trim(),
          runsRoot: 'runs',
          runId: `crew-${process.pid}`,
          tools,
          onBeforeDelegate: selection.onBeforeDelegate,
        });
        if (outcome.kind === 'done') {
          console.log(
            typeof outcome.output === 'string'
              ? outcome.output
              : JSON.stringify(outcome.output, null, 2),
          );
        } else {
          console.error(
            `Crew failed at ${outcome.failedTask ?? '?'}: ${outcome.message}`,
          );
          process.exitCode = 1;
        }
      } finally {
        await selection.close();
      }
    } finally {
      await fetchServer.close();
    }
  } finally {
    await fileServer.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 6: Add the `crew` script to `package.json`**

In `scripts`, after `"flow"`:

```json
    "crew": "bun run src/cli/crew.ts",
```

- [ ] **Step 6b: Wire live selection into `src/cli/flow.ts`** (so workflows get it too)

Add `onBeforeDelegate?: BeforeDelegate` to `FlowDeps` (import `BeforeDelegate` from `../core/delegate.ts`); thread it into the agent steps by changing `runFlow`'s `runWorkflow` call from `defaultRunAgentStep(deps.agents)` to `defaultRunAgentStep(deps.agents, deps.onBeforeDelegate)`. In `main()`, build the runtime and pass + close it, mirroring `crew.ts`:

```typescript
// inside main(), after mounting file+fetch servers, wrapping the runFlow call:
const selection = await createSelectionRuntime();
try {
  // ...existing agent-map build + runFlow(...), adding:
  //   onBeforeDelegate: selection.onBeforeDelegate,
} finally {
  await selection.close();
}
```

Add `import { createSelectionRuntime } from './select-runtime.ts';` to `flow.ts`. Keep the existing `tests/cli/flow.test.ts` green (it calls `runFlow` directly without `onBeforeDelegate` — still valid since the field is optional). Run `bun test tests/cli/flow.test.ts && bun run typecheck` → PASS (regression: flow still works).

- [ ] **Step 7: Write the live integration test `tests/integration/crew.live.test.ts`**

Mirror the live-skip guard used by `tests/integration/workflow.live.test.ts` (copy its exact predicate — e.g. `ollamaReady()` + `describe.skipIf`). Body:

```typescript
import { describe, expect, it } from 'bun:test';
// Reuse the SAME skip mechanism workflow.live.test.ts uses (check that file
// and copy its guard verbatim; the helper name/import must match the repo).
import { ollamaReady } from '../helpers/ollama-ready.ts'; // <- match the real path used by workflow.live

const live = await ollamaReady();
const maybe = live ? it : it.skip;

describe('crew.live', () => {
  maybe('runs the sequential research crew end-to-end', async () => {
    const { runCrewCli } = await import('../../src/cli/crew.ts');
    const { getCrew } = await import('../../crews/index.ts');
    const { createFetchTools, createFileTools } = await import('../../src/mcp/client.ts');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const def = getCrew('research-crew');
    expect(def).toBeDefined();
    const fileServer = await createFileTools();
    const fetchServer = await createFetchTools();
    try {
      const runsRoot = await mkdtemp(join(tmpdir(), 'crewlive-'));
      const outcome = await runCrewCli({
        def: def!, input: 'the example.com domain', runsRoot, runId: 'live',
        tools: { ...fileServer.tools, ...fetchServer.tools },
      });
      expect(outcome.kind).toBe('done');
    } finally {
      await fetchServer.close();
      await fileServer.close();
    }
  }, 180_000);
});
```

- [ ] **Step 8: Run tests + full gate**

Run: `bun test tests/cli/select-runtime.test.ts tests/cli/crew.test.ts tests/cli/flow.test.ts && bun run typecheck && bun run lint:file -- "src/cli/select-runtime.ts" "src/cli/crew.ts" "src/cli/flow.ts" "crews/*.ts" && bun test`
Expected: unit tests PASS; flow regression green; live test skips when Ollama down; typecheck + lint clean; full suite green.

- [ ] **Step 9: Commit**

```bash
git add src/cli/select-runtime.ts src/cli/crew.ts src/cli/flow.ts crews/ package.json tests/cli/select-runtime.test.ts tests/cli/crew.test.ts tests/integration/crew.live.test.ts
git commit -m "feat(crew): crew CLI + registry + example; live model selection for flow+crew CLIs"
```

---

