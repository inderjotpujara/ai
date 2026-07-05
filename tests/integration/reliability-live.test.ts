import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { z } from 'zod';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { runGuardedAgent } from '../../src/core/delegate.ts';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
  RuntimeKind,
} from '../../src/core/types.ts';
import { createOllamaModel } from '../../src/providers/ollama.ts';
import { createLedger, DegradeKind } from '../../src/reliability/ledger.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import { StepKind } from '../../src/workflow/types.ts';

// Gated: real Ollama + a genuinely-unreachable MLX server (localhost:1234) are
// required. Run with: RELIABILITY_LIVE=1 bun test tests/integration/reliability-live.test.ts
const LIVE = process.env.RELIABILITY_LIVE === '1';

/** A model no real Ollama daemon will ever have installed — used to force a
 *  genuine (not mocked) provider-level failure for the AgentDropped scenarios. */
const BAD_DECL: ModelDeclaration = {
  runtime: RuntimeKind.Ollama,
  model: 'definitely-not-a-real-model:latest',
  params: {},
  role: 'live-verify-bad-model',
  footprint: { approxParamsBillions: 0, bytesPerWeight: 0.55 },
};

function deadAgent(name: string): Agent {
  return {
    name,
    description: 'agent whose declared model does not exist on the daemon',
    model: createOllamaModel(BAD_DECL),
    systemPrompt: 'test',
    tools: {},
  };
}

describe.skipIf(!LIVE)('reliability live-verify (real Ollama)', () => {
  test('runtime degrade → ModelDegraded, and the Ollama fallback model actually answers', async () => {
    const ledger = createLedger();
    // MLX genuinely unreachable (nothing listens on localhost:1234 in this env);
    // fallbackModel names a real installed Ollama tag.
    const mlxDecl: ModelDeclaration = {
      runtime: RuntimeKind.MlxServer,
      model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
      params: {},
      role: 'general reasoning + tool use',
      capabilities: [Capability.Tools],
      footprint: { approxParamsBillions: 7, bytesPerWeight: 0.55 },
      fallbackModel: 'qwen3.5:4b',
    };
    const agent: Agent = {
      name: 'file_qa',
      description: 'd',
      model: undefined as never,
      systemPrompt: 'sp',
      tools: {},
      modelReq: {
        role: 'r',
        requires: [Capability.Tools],
        prefer: PreferPolicy.LargestThatFits,
      },
    };
    const hook = createSelectHook({
      registry: [mlxDecl],
      // Memory-fit accounting (model-manager.ensureReady) is exercised live
      // elsewhere (tests/integration/selection.live.test.ts); this scenario
      // targets the runtime-degrade branch, so a lightweight stub stands in
      // here while `runtimeFor` (below) stays the REAL registry — the MLX
      // unreachability check is genuine, not mocked.
      ensureReady: async () => 4096,
      pinned: [],
      capture: {},
      ledger,
      log: () => {},
    });

    const pre = await hook(agent);
    if (!pre) throw new Error('hook returned void');
    expect(pre.abort).toBeUndefined();
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({
      kind: DegradeKind.ModelDegraded,
      subject: mlxDecl.model,
      to: 'ollama',
    });

    // Prove the degraded model is not just selected but actually WORKS.
    if (!pre.model) throw new Error('expected a bound fallback model');
    const result = await generateText({
      model: pre.model,
      prompt: 'Reply with a single short sentence about the ocean.',
    });
    expect(result.text.trim().length).toBeGreaterThan(0);
  }, 60_000);

  test('tool-step retry → Retried ledger event on a real workflow run', async () => {
    let calls = 0;
    const flakyTool = {
      description: 'flaky',
      inputSchema: z.object({}),
      execute: async () => {
        calls++;
        if (calls < 2) {
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        }
        return 'ok';
      },
    };
    const def = {
      id: 'wf-live',
      steps: [
        {
          id: 's1',
          kind: StepKind.Tool,
          tool: 'flaky',
          input: () => ({}),
          output: z.any(),
          retry: true,
        },
      ],
    };
    const ledger = createLedger();
    const outcome = await runWorkflow(
      def as never,
      {},
      {
        runAgentStep: async () => 'x',
        tools: { flaky: flakyTool } as never,
        ledger,
      },
    );
    expect(calls).toBe(2);
    expect(outcome.kind).toBe('done');
    const retried = ledger.events.find((e) => e.kind === DegradeKind.Retried);
    expect(retried).toBeDefined();
    expect(retried?.subject).toBe('tool:flaky');
  }, 30_000);

  test('agent dropped → AgentDropped, run survives (real Ollama rejects an unknown model)', async () => {
    const ledger = createLedger();
    const result = await runGuardedAgent(
      deadAgent('dead_agent'),
      'do it',
      undefined,
      undefined,
      ledger,
    );
    expect('error' in result).toBe(true);
    expect(ledger.events.some((e) => e.kind === DegradeKind.AgentDropped)).toBe(
      true,
    );
  }, 30_000);

  test('persistence + telemetry: withMcpRun writes degradation.jsonl and a reliability.degrade span event', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'reliability-live-'));
    const runId = 'live-verify-1';
    try {
      await withMcpRun(
        { runsRoot, runId, config: { entries: [], dormant: [], warnings: [] } },
        async (ctx) => {
          const result = await runGuardedAgent(
            deadAgent('dead_agent_persist'),
            'do it',
            undefined,
            undefined,
            ctx.ledger,
          );
          expect('error' in result).toBe(true);
        },
      );

      const runDir = join(runsRoot, runId);
      const ledgerLines = (
        await readFile(join(runDir, 'degradation.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(ledgerLines.some((e) => e.kind === DegradeKind.AgentDropped)).toBe(
        true,
      );

      const spanLines = (await readFile(join(runDir, 'spans.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const degradeEvent = spanLines
        .flatMap((s) => s.events ?? [])
        .find((e: { name: string }) => e.name === 'reliability.degrade');
      expect(degradeEvent).toBeDefined();
      expect(degradeEvent.attributes?.['error.type']).toBe(
        DegradeKind.AgentDropped,
      );
    } finally {
      await rm(runsRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
