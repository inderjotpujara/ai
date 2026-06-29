# Slice 2: Super-Agent / Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic orchestrator agent that routes a user task to a matching sub-agent (agents-as-tools) or, when none fits, reports a capability gap — never attempting the task itself.

**Architecture:** The orchestrator is itself an `Agent` (its own model + system prompt) whose tools are `delegate_to_<name>(task)` wrappers around sub-agents plus a `report_capability_gap(missingCapability)` tool. Routing is the orchestrator model's tool selection — no new engine; it reuses Slice 1's `runAgent` loop. Gap detection is deterministic by inspecting the run's `steps` for a `report_capability_gap` tool call.

**Tech Stack:** Bun + TypeScript + Vercel AI SDK 6 (`ai@^6`), `zod@^4`. Tests use `MockLanguageModelV3` from `ai/test` under `bun test` (no Ollama).

## Global Constraints

- Stack: Bun + TypeScript, ESM. Pins unchanged: `ai@^6` (NOT v7 — renames `stepCountIs`/`MockLanguageModelV3`), `ollama-ai-provider-v2@^3`, `@ai-sdk/mcp@^1`, `@modelcontextprotocol/sdk@^1`, `zod@^4`.
- Code style: `type` over `interface`; **string enums** for finite sets; early returns; small single-responsibility files; plain self-explanatory code; **no `!` non-null assertions** (Biome forbids them — use optional chaining); typed errors.
- Tests: `bun run test:file -- ./path` (single file); `bun run typecheck`; `bun run lint` (a `biome.json` deprecation NOTICE is acceptable — no errors). Mirror the **proven mock-model shape** from `tests/core/agent.test.ts` verbatim: `finishReason: { unified: 'tool-calls'|'stop', raw: undefined }`, `usage: { inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }`, `warnings: []`, tool-call content `{ type:'tool-call', toolCallId, toolName, input: JSON.stringify({...}) }`.
- `Agent.model` is a resolved **`LanguageModel`** (not a declaration). Model *declarations* live in `models/`; `agents/*.ts` resolve them via `createOllamaModel(decl)` at construction. This keeps declarations as data while making agents injectable with a mock model in tests. (Refines the spec's "model (declaration)" — resolution moves to construction time.)
- git is initialized; you are on branch `slice-2-orchestrator`. Commit each task; do NOT `git init`.

---

### Task 1: Extend `runAgent` to return `steps`

**Files:**
- Modify: `src/core/agent.ts`
- Test: `tests/core/agent.test.ts` (add one assertion)

**Interfaces:**
- Consumes: `generateText` (ai).
- Produces: `runAgent(input): Promise<{ text: string; steps: Awaited<ReturnType<typeof generateText>>['steps'] }>`. Backward-compatible: existing `const { text } = await runAgent(...)` callers (e.g. `answer-file-question.ts`) are unaffected.

- [ ] **Step 1: Add a failing assertion** — append to the existing first test in `tests/core/agent.test.ts`, right after the `expect(text).toBe('The file says hello.')` line, change the destructure on line ~65 from `const { text } =` to `const { text, steps } =` and add:

```ts
  expect(Array.isArray(steps)).toBe(true);
  expect(steps.length).toBeGreaterThanOrEqual(2); // tool-call step + final-text step
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/agent.test.ts`
Expected: FAIL — `steps` does not exist on the result of `runAgent` (or typecheck error).

- [ ] **Step 3: Update `runAgent`** in `src/core/agent.ts` — change the return to include `steps`:

```ts
/** Run one agent turn: model + tools loop, bounded by a step guard. Returns text + steps. */
export async function runAgent(
  input: RunAgentInput,
): Promise<{ text: string; steps: Awaited<ReturnType<typeof generateText>>['steps'] }> {
  const result = await generateText({
    model: input.model,
    system: input.systemPrompt,
    prompt: input.prompt,
    tools: input.tools,
    temperature: input.temperature,
    providerOptions: input.providerOptions,
    stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
  });
  const { text, finishReason, steps } = result;
  if (text.trim() === '' && finishReason !== 'stop') {
    throw new MaxStepsError(
      `Agent exhausted step ceiling (${steps.length} steps) without producing a final answer.`,
    );
  }
  return { text, steps };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:file -- ./tests/core/agent.test.ts` then `bun run typecheck`
Expected: PASS (both tests); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent.ts tests/core/agent.test.ts
git commit -m "feat(core): runAgent returns steps for downstream inspection"
```

---

### Task 2: Add `DelegationError`

**Files:**
- Modify: `src/core/errors.ts`
- Test: `tests/core/errors.test.ts` (add one test)

**Interfaces:**
- Produces: `class DelegationError extends Error` with `name === 'DelegationError'` (same `FrameworkError` base as the others).

- [ ] **Step 1: Write the failing test** — append to `tests/core/errors.test.ts`:

```ts
import { DelegationError } from '../../src/core/errors.ts';

test('DelegationError carries its class name', () => {
  const err = new DelegationError('sub-agent file_qa failed');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('DelegationError');
  expect(err.message).toBe('sub-agent file_qa failed');
});
```

(Adjust the existing import line at the top of the file to also import `DelegationError`, or add the new import shown above — keep one import per symbol set.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/errors.test.ts`
Expected: FAIL — `DelegationError` not exported.

- [ ] **Step 3: Add the error** in `src/core/errors.ts`, after `ResourceError`:

```ts
/** A delegated sub-agent run failed irrecoverably. */
export class DelegationError extends FrameworkError {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/core/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/errors.ts tests/core/errors.test.ts
git commit -m "feat(core): add DelegationError"
```

---

### Task 3: `Agent` definition + `runDefinedAgent`

**Files:**
- Create: `src/core/agent-def.ts`
- Test: `tests/core/agent-def.test.ts`

**Interfaces:**
- Consumes: `runAgent` (src/core/agent.ts), `LanguageModel`/`ToolSet` (ai).
- Produces:
  - `type Agent = { name: string; description: string; model: LanguageModel; systemPrompt: string; tools: ToolSet }`
  - `runDefinedAgent(agent: Agent, task: string): Promise<{ text: string; steps: Awaited<ReturnType<typeof runAgent>>['steps'] }>` — calls `runAgent({ model: agent.model, systemPrompt: agent.systemPrompt, prompt: task, tools: agent.tools })`.

- [ ] **Step 1: Write the failing test** — `tests/core/agent-def.test.ts`:

```ts
import { expect, mock, test } from 'bun:test';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { type Agent, runDefinedAgent } from '../../src/core/agent-def.ts';

test('runDefinedAgent runs the agent on the task and returns text', async () => {
  const execute = mock(async () => ({ value: 42 }));
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  const agent: Agent = {
    name: 'calc',
    description: 'does math',
    model,
    systemPrompt: 'You do math.',
    tools: { add: tool({ description: 'add', inputSchema: z.object({}), execute }) },
  };

  const { text } = await runDefinedAgent(agent, 'what is 40+2?');
  expect(text).toBe('done');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/agent-def.test.ts`
Expected: FAIL — cannot resolve `agent-def.ts`.

- [ ] **Step 3: Create `src/core/agent-def.ts`**

```ts
import type { LanguageModel, ToolSet } from 'ai';
import { runAgent } from './agent.ts';

/** A reusable agent: its own model + system prompt + tools, plus a routing description. */
export type Agent = {
  name: string; // stable id used in delegate tool names, e.g. 'file_qa'
  description: string; // capability description the orchestrator routes on
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolSet;
};

/** Run an agent definition against a task. */
export function runDefinedAgent(
  agent: Agent,
  task: string,
): ReturnType<typeof runAgent> {
  return runAgent({
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/core/agent-def.test.ts` then `bun run typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-def.ts tests/core/agent-def.test.ts
git commit -m "feat(core): add Agent definition and runDefinedAgent"
```

---

### Task 4: `asDelegateTool` (agents-as-tools)

**Files:**
- Create: `src/core/delegate.ts`
- Test: `tests/core/delegate.test.ts`

**Interfaces:**
- Consumes: `Agent`, `runDefinedAgent` (agent-def.ts); `tool` (ai); `DelegationError` (errors.ts).
- Produces:
  - `delegateToolName(agent: Agent): string` → `` `delegate_to_${agent.name}` ``.
  - `asDelegateTool(agent: Agent)` → an AI SDK tool: description = `agent.description`, `inputSchema: z.object({ task: z.string() })`, `execute({task})` runs `runDefinedAgent(agent, task)` and returns `{ text }`; on failure returns `{ error }` (so the orchestrator model sees a tool result, not a crash).

- [ ] **Step 1: Write the failing test** — `tests/core/delegate.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { type Agent } from '../../src/core/agent-def.ts';
import { asDelegateTool, delegateToolName } from '../../src/core/delegate.ts';

function cannedAgent(name: string, answer: string): Agent {
  return {
    name,
    description: `agent ${name}`,
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text', text: answer }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
    systemPrompt: 'test',
    tools: {},
  };
}

test('delegate tool name is delegate_to_<name>', () => {
  expect(delegateToolName(cannedAgent('file_qa', 'x'))).toBe('delegate_to_file_qa');
});

test('asDelegateTool runs the wrapped agent and returns its text', async () => {
  const t = asDelegateTool(cannedAgent('file_qa', 'the answer'));
  const result = await t.execute?.({ task: 'do it' }, {} as never);
  expect(result).toEqual({ text: 'the answer' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/delegate.test.ts`
Expected: FAIL — cannot resolve `delegate.ts`.

- [ ] **Step 3: Create `src/core/delegate.ts`**

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { type Agent, runDefinedAgent } from './agent-def.ts';

/** The orchestrator-facing tool name for delegating to an agent. */
export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}

/**
 * Wrap an agent as a tool the orchestrator can call. On failure it RETURNS a
 * structured error (so the orchestrator model can react) rather than throwing.
 */
export function asDelegateTool(agent: Agent) {
  return tool({
    description: agent.description,
    inputSchema: z.object({ task: z.string().describe('The task for this agent') }),
    execute: async ({ task }) => {
      try {
        const { text } = await runDefinedAgent(agent, task);
        return { text };
      } catch (cause) {
        return { error: `Agent ${agent.name} failed: ${(cause as Error).message}` };
      }
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/core/delegate.test.ts` then `bun run lint`
Expected: PASS; lint clean (no `!`).

- [ ] **Step 5: Commit**

```bash
git add src/core/delegate.ts tests/core/delegate.test.ts
git commit -m "feat(core): add asDelegateTool (agents-as-tools)"
```

---

### Task 5: `report_capability_gap` tool + gap detection

**Files:**
- Create: `src/core/capability-gap.ts`
- Test: `tests/core/capability-gap.test.ts`

**Interfaces:**
- Consumes: `tool` (ai); the steps type from `runAgent`.
- Produces:
  - `CAPABILITY_GAP_TOOL = 'report_capability_gap'` (const).
  - `type CapabilityGap = { missingCapability: string }`.
  - `capabilityGapTool` — AI SDK tool, `inputSchema: z.object({ missingCapability: z.string() })`, `execute` returns `{ reported: true }` (detection is via the call, not the result).
  - `findCapabilityGap(steps): CapabilityGap | undefined` — scans `steps.flatMap(s => s.toolCalls)` for a call whose `toolName === CAPABILITY_GAP_TOOL` and returns its `input` as `CapabilityGap`, else `undefined`.

- [ ] **Step 1: Write the failing test** — `tests/core/capability-gap.test.ts`:

```ts
import { expect, test } from 'bun:test';
import {
  CAPABILITY_GAP_TOOL,
  capabilityGapTool,
  findCapabilityGap,
} from '../../src/core/capability-gap.ts';

test('tool name and schema are exported', () => {
  expect(CAPABILITY_GAP_TOOL).toBe('report_capability_gap');
  expect(capabilityGapTool).toBeDefined();
});

test('findCapabilityGap extracts the missing capability from a matching tool call', () => {
  const steps = [
    { toolCalls: [{ toolName: 'delegate_to_file_qa', input: { task: 'x' } }] },
    { toolCalls: [{ toolName: 'report_capability_gap', input: { missingCapability: 'book a flight' } }] },
  ] as never;
  expect(findCapabilityGap(steps)).toEqual({ missingCapability: 'book a flight' });
});

test('findCapabilityGap returns undefined when no gap was reported', () => {
  const steps = [
    { toolCalls: [{ toolName: 'delegate_to_file_qa', input: { task: 'x' } }] },
  ] as never;
  expect(findCapabilityGap(steps)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/capability-gap.test.ts`
Expected: FAIL — cannot resolve `capability-gap.ts`.

- [ ] **Step 3: Create `src/core/capability-gap.ts`**

```ts
import { tool, type generateText } from 'ai';
import { z } from 'zod';

/** The tool the orchestrator calls when no registered agent can handle a task. */
export const CAPABILITY_GAP_TOOL = 'report_capability_gap';

export type CapabilityGap = { missingCapability: string };

type Steps = Awaited<ReturnType<typeof generateText>>['steps'];

/**
 * Tool the orchestrator calls when nothing fits. The FUTURE agent-builder hooks
 * in here. Detection happens from the run's steps (the call), not this result.
 */
export const capabilityGapTool = tool({
  description:
    'Call this ONLY when no available agent can handle the task. Describe the missing capability.',
  inputSchema: z.object({
    missingCapability: z
      .string()
      .describe('The capability that is missing, in plain words'),
  }),
  execute: async () => ({ reported: true }),
});

/** Find a reported capability gap in a run's steps, if any. */
export function findCapabilityGap(steps: Steps): CapabilityGap | undefined {
  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (call.toolName === CAPABILITY_GAP_TOOL) {
        return call.input as CapabilityGap;
      }
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/core/capability-gap.test.ts` then `bun run typecheck`
Expected: PASS; typecheck exit 0. (If TS rejects `import { type generateText }`, use `import type { generateText } from 'ai'` on its own line and keep `import { tool } from 'ai'`.)

- [ ] **Step 5: Commit**

```bash
git add src/core/capability-gap.ts tests/core/capability-gap.test.ts
git commit -m "feat(core): add report_capability_gap tool + gap detection"
```

---

### Task 6: Orchestrator (`createOrchestrator` + `runOrchestrator`)

**Files:**
- Create: `src/core/orchestrator.ts`
- Test: `tests/core/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Agent`, `runDefinedAgent` (agent-def.ts); `asDelegateTool` (delegate.ts); `capabilityGapTool`, `findCapabilityGap`, `CapabilityGap` (capability-gap.ts); `LanguageModel`, `ToolSet` (ai).
- Produces:
  - `type OrchestratorResult = { kind: 'answer'; text: string } | { kind: 'gap'; missingCapability: string; message: string }`.
  - `createOrchestrator(opts: { name?: string; model: LanguageModel; systemPrompt: string; agents: Agent[] }): Agent` — returns an `Agent` whose `tools` = each sub-agent's delegate tool keyed by `delegate_to_<name>` + `report_capability_gap: capabilityGapTool`.
  - `runOrchestrator(orchestrator: Agent, task: string): Promise<OrchestratorResult>` — runs `runDefinedAgent(orchestrator, task)`, then `findCapabilityGap(steps)`: if found → `{ kind:'gap', missingCapability, message }`; else → `{ kind:'answer', text }`.
  - `buildRoutingPrompt(basePrompt: string, agents: Agent[]): string` — appends each agent's `name: description` and the routing rules.

- [ ] **Step 1: Write the failing tests** — `tests/core/orchestrator.test.ts`:

```ts
import { expect, mock, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { type Agent } from '../../src/core/agent-def.ts';
import { createOrchestrator, runOrchestrator } from '../../src/core/orchestrator.ts';

// A sub-agent whose model returns a fixed answer; spy via the model's doGenerate.
function subAgent(name: string, answer: string): { agent: Agent; ran: () => number } {
  let calls = 0;
  const agent: Agent = {
    name,
    description: `handles ${name} tasks`,
    model: new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        return {
          content: [{ type: 'text', text: answer }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: undefined, reasoning: undefined },
          },
          warnings: [],
        };
      },
    }),
    systemPrompt: 'sub',
    tools: {},
  };
  return { agent, ran: () => calls };
}

// Orchestrator model that emits a single tool-call to `toolName`, then (turn 2) final text.
function orchModel(toolName: string, input: unknown) {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName, input: JSON.stringify(input) }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: undefined, reasoning: undefined },
          },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: 'orchestrator final text' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

test('delegation path: orchestrator delegates and returns kind:answer', async () => {
  const { agent, ran } = subAgent('file_qa', 'fox and dog');
  const orch = createOrchestrator({
    model: orchModel('delegate_to_file_qa', { task: 'read it' }),
    systemPrompt: 'route',
    agents: [agent],
  });
  const result = await runOrchestrator(orch, 'what does the file say?');
  expect(result.kind).toBe('answer');
  expect(ran()).toBe(1); // the sub-agent ran
});

test('capability-gap path: returns kind:gap and runs no sub-agent', async () => {
  const { agent, ran } = subAgent('file_qa', 'should not run');
  const orch = createOrchestrator({
    model: orchModel('report_capability_gap', { missingCapability: 'book a flight' }),
    systemPrompt: 'route',
    agents: [agent],
  });
  const result = await runOrchestrator(orch, 'book me a flight');
  expect(result.kind).toBe('gap');
  if (result.kind === 'gap') {
    expect(result.missingCapability).toBe('book a flight');
    expect(result.message).toContain('book a flight');
  }
  expect(ran()).toBe(0); // no sub-agent ran
});

test('multi-agent selection: only the chosen delegate runs', async () => {
  const a = subAgent('file_qa', 'A');
  const b = subAgent('calc', 'B');
  const orch = createOrchestrator({
    model: orchModel('delegate_to_calc', { task: '2+2' }),
    systemPrompt: 'route',
    agents: [a.agent, b.agent],
  });
  const result = await runOrchestrator(orch, 'compute 2+2');
  expect(result.kind).toBe('answer');
  expect(a.ran()).toBe(0);
  expect(b.ran()).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:file -- ./tests/core/orchestrator.test.ts`
Expected: FAIL — cannot resolve `orchestrator.ts`.

- [ ] **Step 3: Create `src/core/orchestrator.ts`**

```ts
import type { LanguageModel, ToolSet } from 'ai';
import { type Agent, runDefinedAgent } from './agent-def.ts';
import {
  CAPABILITY_GAP_TOOL,
  capabilityGapTool,
  findCapabilityGap,
} from './capability-gap.ts';
import { asDelegateTool, delegateToolName } from './delegate.ts';

export type OrchestratorResult =
  | { kind: 'answer'; text: string }
  | { kind: 'gap'; missingCapability: string; message: string };

/** Build the orchestrator's system prompt: routing rules + the agent catalog. */
export function buildRoutingPrompt(basePrompt: string, agents: Agent[]): string {
  const catalog = agents
    .map((a) => `- ${a.name}: ${a.description}`)
    .join('\n');
  return [
    basePrompt,
    '',
    'Available agents:',
    catalog,
    '',
    'Understand the user intent. If an agent fits, call its delegate_to_<name> tool with the task.',
    `If NO agent can handle it, call ${CAPABILITY_GAP_TOOL} with the missing capability.`,
    'Never attempt the task yourself.',
  ].join('\n');
}

/** Create the orchestrator: an Agent whose tools delegate to sub-agents (+ gap tool). */
export function createOrchestrator(opts: {
  name?: string;
  model: LanguageModel;
  systemPrompt: string;
  agents: Agent[];
}): Agent {
  const tools: ToolSet = { [CAPABILITY_GAP_TOOL]: capabilityGapTool };
  for (const agent of opts.agents) {
    tools[delegateToolName(agent)] = asDelegateTool(agent);
  }
  return {
    name: opts.name ?? 'orchestrator',
    description: 'Routes tasks to specialized agents or reports a capability gap.',
    model: opts.model,
    systemPrompt: buildRoutingPrompt(opts.systemPrompt, opts.agents),
    tools,
  };
}

/** Run the orchestrator; return either the answer or a reported capability gap. */
export async function runOrchestrator(
  orchestrator: Agent,
  task: string,
): Promise<OrchestratorResult> {
  const { text, steps } = await runDefinedAgent(orchestrator, task);
  const gap = findCapabilityGap(steps);
  if (gap) {
    return {
      kind: 'gap',
      missingCapability: gap.missingCapability,
      message: `I don't have a capability to handle this yet: ${gap.missingCapability}.`,
    };
  }
  return { kind: 'answer', text };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:file -- ./tests/core/orchestrator.test.ts` then `bun run typecheck && bun run lint`
Expected: PASS (3 tests); typecheck + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts tests/core/orchestrator.test.ts
git commit -m "feat(core): add orchestrator (delegate or report capability gap)"
```

---

### Task 7: file-Q&A agent definition

**Files:**
- Create: `agents/file-qa.ts`
- Test: `tests/agents/file-qa.test.ts`

**Interfaces:**
- Consumes: `Agent` (src/core/agent-def.ts); `createOllamaModel` (src/providers/ollama.ts); `qwenFast` (models/qwen-fast.ts); `ToolSet` (ai).
- Produces: `createFileQaAgent(tools: ToolSet): Agent` — name `'file_qa'`, a description that says it answers questions about the contents of a specific local file, model resolved from `qwenFast`, the Slice-1 file-Q&A system prompt, and the passed-in `tools` (the MCP `read_file` toolset injected by the caller).

- [ ] **Step 1: Write the failing test** — `tests/agents/file-qa.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { createFileQaAgent } from '../../agents/file-qa.ts';

test('file-qa agent has the expected identity and injected tools', () => {
  const tools = { read_file: { description: 'x' } } as never;
  const agent = createFileQaAgent(tools);
  expect(agent.name).toBe('file_qa');
  expect(agent.description.toLowerCase()).toContain('file');
  expect(agent.tools).toBe(tools);
  expect(agent.model).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/agents/file-qa.test.ts`
Expected: FAIL — cannot resolve `agents/file-qa.ts`.

- [ ] **Step 3: Create `agents/file-qa.ts`**

```ts
import type { ToolSet } from 'ai';
import { type Agent } from '../src/core/agent-def.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import qwenFast from '../models/qwen-fast.ts';

const SYSTEM_PROMPT =
  'You answer questions about local files. Use the read_file tool to read any file you need, then answer concisely.';

/** Build the file-Q&A agent with an injected tool set (e.g. the MCP read_file tools). */
export function createFileQaAgent(tools: ToolSet): Agent {
  return {
    name: 'file_qa',
    description:
      'Answers questions about, and summarizes, the contents of a specific local file using read_file.',
    model: createOllamaModel(qwenFast),
    systemPrompt: SYSTEM_PROMPT,
    tools,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/agents/file-qa.test.ts` then `bun run typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add agents/file-qa.ts tests/agents/file-qa.test.ts
git commit -m "feat(agents): file-qa as a reusable Agent definition"
```

---

### Task 8: super-agent (orchestrator) configuration

**Files:**
- Create: `agents/super.ts`
- Test: `tests/agents/super.test.ts`

**Interfaces:**
- Consumes: `createOrchestrator` (src/core/orchestrator.ts); `Agent` (agent-def.ts); `createOllamaModel` (providers/ollama.ts); `qwenFast` (models/qwen-fast.ts); `ToolSet` (ai).
- Produces: `createSuperAgent(fileQaTools: ToolSet): Agent` — builds the file-Q&A agent (via `createFileQaAgent`) and returns `createOrchestrator({ model: createOllamaModel(qwenFast), systemPrompt: <base routing prompt>, agents: [fileQa] })`. The orchestrator's own model is qwen3:8b.

- [ ] **Step 1: Write the failing test** — `tests/agents/super.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import { CAPABILITY_GAP_TOOL } from '../../src/core/capability-gap.ts';

test('super agent exposes a delegate_to_file_qa tool and the gap tool', () => {
  const tools = { read_file: { description: 'x' } } as never;
  const sup = createSuperAgent(tools);
  expect(Object.keys(sup.tools)).toContain('delegate_to_file_qa');
  expect(Object.keys(sup.tools)).toContain(CAPABILITY_GAP_TOOL);
  expect(sup.model).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/agents/super.test.ts`
Expected: FAIL — cannot resolve `agents/super.ts`.

- [ ] **Step 3: Create `agents/super.ts`**

```ts
import type { ToolSet } from 'ai';
import { type Agent } from '../src/core/agent-def.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import qwenFast from '../models/qwen-fast.ts';
import { createFileQaAgent } from './file-qa.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with the file-Q&A agent registered. */
export function createSuperAgent(fileQaTools: ToolSet): Agent {
  const fileQa = createFileQaAgent(fileQaTools);
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenFast),
    systemPrompt: BASE_PROMPT,
    agents: [fileQa],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/agents/super.test.ts` then `bun run typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add agents/super.ts tests/agents/super.test.ts
git commit -m "feat(agents): super-agent orchestrator config with file-qa"
```

---

### Task 9: CLI orchestration + entrypoint

**Files:**
- Create: `src/cli/run-chat.ts`
- Modify: `src/cli/chat.ts`
- Delete: `src/cli/answer-file-question.ts` and `tests/cli/answer-file-question.test.ts` (replaced by the orchestrator path)
- Test: `tests/cli/run-chat.test.ts`

**Interfaces:**
- Consumes: `Agent`, `runOrchestrator`, `OrchestratorResult` (orchestrator.ts); `createRun`, `writeArtifact` (run/run-store.ts); `appendJournal` (run/journal.ts).
- Produces:
  - `runChat(deps: { orchestrator: Agent; task: string; runsRoot: string; runId: string }): Promise<OrchestratorResult>` — journals `start`, runs `runOrchestrator`, writes `answer.txt` (the text) or `gap.txt` (the message), journals `answer`/`gap` with the delegated info, returns the result.
  - `src/cli/chat.ts` — wires resource warm-up (Slice 1) + MCP tools + `createSuperAgent(tools)` + `runChat`, prints the answer or the gap message, unloads + closes in `finally`.

- [ ] **Step 1: Write the failing test** — `tests/cli/run-chat.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { createOrchestrator } from '../../src/core/orchestrator.ts';
import { type Agent } from '../../src/core/agent-def.ts';
import { runChat } from '../../src/cli/run-chat.ts';
import { readJournal } from '../../src/run/journal.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function gapOrchestrator(): Agent {
  // orchestrator model that calls report_capability_gap on turn 1
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'report_capability_gap', input: JSON.stringify({ missingCapability: 'send email' }) }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: { inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: undefined, reasoning: undefined } },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: '' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: undefined, reasoning: undefined } },
        warnings: [],
      };
    },
  });
  return createOrchestrator({ model, systemPrompt: 'route', agents: [] });
}

test('runChat records a gap run and writes the gap artifact', async () => {
  const result = await runChat({
    orchestrator: gapOrchestrator(),
    task: 'email my boss',
    runsRoot: root,
    runId: 'run-1',
  });
  expect(result.kind).toBe('gap');
  expect(await readFile(join(root, 'run-1', 'gap.txt'), 'utf8')).toContain('send email');
  const journal = await readJournal(join(root, 'run-1'));
  expect(journal.map((e) => e.step)).toEqual(['start', 'gap']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/cli/run-chat.test.ts`
Expected: FAIL — cannot resolve `run-chat.ts`.

- [ ] **Step 3: Create `src/cli/run-chat.ts`**

```ts
import type { Agent } from '../core/agent-def.ts';
import { type OrchestratorResult, runOrchestrator } from '../core/orchestrator.ts';
import { appendJournal } from '../run/journal.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';

export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  runsRoot: string;
  runId: string;
};

/** Orchestrate one chat run: journal, run orchestrator, write artifact, journal. */
export async function runChat(deps: ChatDeps): Promise<OrchestratorResult> {
  const run = await createRun(deps.runsRoot, deps.runId);
  await appendJournal(run.dir, { step: 'start', data: { task: deps.task } });

  const result = await runOrchestrator(deps.orchestrator, deps.task);

  if (result.kind === 'answer') {
    await writeArtifact(run, 'answer.txt', result.text);
    await appendJournal(run.dir, { step: 'answer', data: { text: result.text } });
  } else {
    await writeArtifact(run, 'gap.txt', result.message);
    await appendJournal(run.dir, {
      step: 'gap',
      data: { missingCapability: result.missingCapability },
    });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/cli/run-chat.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `src/cli/chat.ts`** with the orchestrator wiring (full file):

```ts
import qwenFast from '../../models/qwen-fast.ts';
import { createSuperAgent } from '../../agents/super.ts';
import { ResourceError } from '../core/errors.ts';
import { createFileTools } from '../mcp/client.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget, machineBudgetBytes } from '../resource/hardware.ts';
import {
  isModelInstalled,
  pullModel,
  unloadModel,
  warmModel,
} from '../resource/ollama-control.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
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

  const { tools, close } = await createFileTools();
  try {
    const orchestrator = createSuperAgent(tools);
    const result = await runChat({
      orchestrator,
      task,
      runsRoot: 'runs',
      runId: `run-${process.pid}`,
    });
    console.log(result.kind === 'answer' ? result.text : result.message);
  } finally {
    await close();
    await unloadModel(qwenFast.model);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Remove the superseded file-Q&A path**

Run:
```bash
git rm src/cli/answer-file-question.ts tests/cli/answer-file-question.test.ts
```

- [ ] **Step 7: Typecheck, lint, full suite**

Run: `bun run typecheck && bun run lint && bun test`
Expected: typecheck 0; lint 0 (only the biome.json NOTICE); all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/cli/run-chat.ts src/cli/chat.ts tests/cli/run-chat.test.ts
git commit -m "feat(cli): drive the orchestrator (answer or capability-gap), replace direct file-qa path"
```

---

### Task 10: Opt-in live integration test

**Files:**
- Create: `tests/integration/ollama-available.ts`
- Create: `tests/integration/orchestrator.live.test.ts`

**Interfaces:**
- Consumes: `createSuperAgent` (agents/super.ts); `createFileTools` (src/mcp/client.ts); `runOrchestrator` (orchestrator.ts); `isModelInstalled`, `warmModel`, `unloadModel` (resource/ollama-control.ts).
- Produces: `ollamaReady(model: string): Promise<boolean>` — true iff `GET http://localhost:11434/api/version` succeeds AND `isModelInstalled(model)`. The live test uses `test.skipIf(!ready)` so it auto-skips.

- [ ] **Step 1: Create the probe** — `tests/integration/ollama-available.ts`:

```ts
import { isModelInstalled } from '../../src/resource/ollama-control.ts';

/** True iff Ollama is reachable AND the given model is already installed. */
export async function ollamaReady(model: string): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/version', {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    return await isModelInstalled(model);
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create the live test** — `tests/integration/orchestrator.live.test.ts`:

```ts
import { afterAll, describe, expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import { createFileTools } from '../../src/mcp/client.ts';
import { runOrchestrator } from '../../src/core/orchestrator.ts';
import { unloadModel, warmModel } from '../../src/resource/ollama-control.ts';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ollamaReady } from './ollama-available.ts';

const MODEL = 'qwen3:8b';
const ready = await ollamaReady(MODEL);

describe.skipIf(!ready)('live orchestrator (real Ollama)', () => {
  afterAll(async () => {
    await unloadModel(MODEL);
  });

  test('delegates a file question to file-qa and answers', async () => {
    await warmModel(MODEL);
    const dir = await mkdtemp(join(tmpdir(), 'live-'));
    const path = join(dir, 'animals.txt');
    await writeFile(path, 'The fox and the dog are friends.');
    const { tools, close } = await createFileTools();
    try {
      const orch = createSuperAgent(tools);
      const result = await runOrchestrator(orch, `What animals are in ${path}?`);
      expect(result.kind).toBe('answer');
      if (result.kind === 'answer') {
        expect(result.text.toLowerCase()).toMatch(/fox|dog/);
      }
    } finally {
      await close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('reports a capability gap for an out-of-scope request', async () => {
    await warmModel(MODEL);
    const { tools, close } = await createFileTools();
    try {
      const orch = createSuperAgent(tools);
      const result = await runOrchestrator(
        orch,
        'Book me a flight to Tokyo for next Tuesday.',
      );
      expect(result.kind).toBe('gap');
    } finally {
      await close();
    }
  }, 120_000);
});
```

- [ ] **Step 3: Run the suite (test auto-skips if Ollama/model absent)**

Run: `bun test` then `bun run typecheck && bun run lint`
Expected: all tests pass; the live block either runs (if Ollama + qwen3:8b present) or is skipped — `bun test` stays green either way. typecheck + lint clean.

- [ ] **Step 4: (Optional) manual live confirmation** — if you want to force the live path:

```bash
# in one terminal: bun run serve   (quit the menu-bar Ollama first)
bun test ./tests/integration/orchestrator.live.test.ts
```
Expected: both live tests pass (delegate → fox/dog answer; out-of-scope → gap).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/ollama-available.ts tests/integration/orchestrator.live.test.ts
git commit -m "test(integration): opt-in live orchestrator test (auto-skips without Ollama)"
```

---

## Self-Review

**1. Spec coverage:**
- Agent abstraction → Task 3. ✓
- Agents-as-tools delegation → Task 4 (`asDelegateTool`) + Task 6 (orchestrator wires them). ✓
- `report_capability_gap` tool + deterministic detection → Task 5; consumed in Task 6. ✓
- Orchestrator with own model + routing prompt → Tasks 6, 8. ✓
- Refactor file-qa into a reusable definition → Task 7; old inline path removed in Task 9. ✓
- CLI drives orchestrator; journal records agent/gap → Task 9. ✓
- `runAgent` returns steps (prerequisite) → Task 1. ✓
- `DelegationError` → Task 2 (used by `asDelegateTool`'s catch in Task 4). ✓
- Mock-model tests for delegation / gap / multi-agent selection → Task 6. ✓
- Opt-in auto-skipping live integration test → Task 10. ✓
- DoD (delegate path + gap path + journal + green suite + typecheck/lint) → Tasks 6, 9, 10. ✓
- Deferred (agent-builder, response-format tooling) → correctly absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has the exact command + expected result.

**3. Type consistency:** `Agent` (Task 3) consumed unchanged by Tasks 4/6/7/8. `runAgent` returns `{ text, steps }` (Task 1) used by `runDefinedAgent` (Task 3) and `runOrchestrator` (Task 6). `OrchestratorResult` discriminated union (Task 6) consumed by `runChat` (Task 9) and the live test (Task 10). `delegate_to_<name>` naming consistent (Task 4 `delegateToolName` → Task 6 wiring → Task 8 assertion). `CAPABILITY_GAP_TOOL` const reused in Tasks 5/6/8. `createFileQaAgent(tools)` (Task 7) consumed by `createSuperAgent` (Task 8). `findCapabilityGap` reads `steps[].toolCalls[].toolName/input` — matches the verified AI SDK 6 `StepResult` shape.

**One note carried into steps:** Task 5 flags the `import type { generateText }` fallback if TS rejects the inline `type` import. Task 1/3 use `Awaited<ReturnType<...>>` to type `steps` without depending on `StepResult` being exported.
