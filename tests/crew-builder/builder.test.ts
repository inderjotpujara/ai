// tests/crew-builder/builder.test.ts
import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCrewOrWorkflow } from '../../src/crew-builder/builder.ts';
import type { CrewBuilderDeps } from '../../src/crew-builder/types.ts';

function tmpPaths() {
  const root = mkdtempSync(join(tmpdir(), 'cwb-'));
  mkdirSync(join(root, 'crews'));
  mkdirSync(join(root, 'workflows'));
  const stub =
    'export const X = {\n  // CREW-BUILDER:ENTRIES\n};\n// CREW-BUILDER:IMPORTS\n';
  writeFileSync(join(root, 'crews/index.ts'), stub);
  writeFileSync(join(root, 'workflows/index.ts'), stub);
  return {
    root,
    paths: {
      crewsDir: join(root, 'crews'),
      crewsIndexPath: join(root, 'crews/index.ts'),
      workflowsDir: join(root, 'workflows'),
      workflowsIndexPath: join(root, 'workflows/index.ts'),
    },
  };
}

// A scripted model: returns queued objects per `object()` call, in order.
// `text()` is only used by analyzeNeed, which doesn't drive branching here.
// A queued `Error` instance is THROWN instead of returned, so a test can
// script the builder's plan-nodes/plan-edges call throwing (e.g. both of
// `makeBuilderModel`'s own internal retries fail) and assert the outer
// regeneration loop's catch branch handles it.
function scriptedModel(queue: unknown[]) {
  let i = 0;
  return {
    object: async () => {
      const next = queue[i++];
      if (next instanceof Error) throw next;
      return next as never;
    },
    text: async () => 'plan',
  };
}

test('builds and writes a workflow end to end', async () => {
  const { root, paths } = tmpPaths();
  try {
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        {
          steps: [
            { id: 'f', kind: 'tool', tool: 'fetch' },
            { id: 'a', kind: 'agent', agent: 'web_fetch' },
          ],
        }, // plan-nodes
        {
          id: 'my_flow',
          steps: [
            {
              kind: 'tool',
              id: 'f',
              tool: 'fetch',
              input: { kind: 'fromInput' },
            },
            {
              kind: 'agent',
              id: 'a',
              agent: 'web_fetch',
              dependsOn: ['f'],
              input: { kind: 'fromStep', ref: 'f' },
            },
          ],
        }, // plan-edges
        { aligned: true, reason: 'ok' }, // goal-alignment
      ]),
      existingAgents: () => ['web_fetch'],
      packNames: () => ['fetch'],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => true,
      buildMissingAgent: async () => {
        throw new Error('should not be called: agent already exists');
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('fetch a url then summarize', deps);
    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.shape).toBe('workflow');
      expect(r.name).toBe('my_flow');
      expect(r.builtAgents).toEqual([]);
      expect(r.files.length).toBeGreaterThan(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns declined when consent is refused', async () => {
  const { root, paths } = tmpPaths();
  try {
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' },
        { steps: [{ id: 'a', kind: 'agent', agent: 'web_fetch' }] },
        {
          id: 'wf',
          steps: [
            {
              kind: 'agent',
              id: 'a',
              agent: 'web_fetch',
              input: { kind: 'fromInput' },
            },
          ],
        },
        { aligned: true, reason: 'ok' },
      ]),
      existingAgents: () => ['web_fetch'],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => false,
      buildMissingAgent: async () => {
        throw new Error('should not be called: agent already exists');
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('x', deps);
    expect(r.kind).toBe('declined');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auto-builds a missing referenced agent exactly once, after consent (D2 invariant)', async () => {
  const { root, paths } = tmpPaths();
  try {
    let confirmed = false;
    let calls = 0;
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        { steps: [{ id: 'a', kind: 'agent', agent: 'web_fetch' }] }, // plan-nodes
        {
          id: 'my_flow',
          steps: [
            {
              kind: 'agent',
              id: 'a',
              agent: 'web_fetch',
              input: { kind: 'fromInput' },
            },
          ],
        }, // plan-edges (the IR)
        { aligned: true, reason: 'ok' }, // goal-alignment
      ]),
      existingAgents: () => [],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => {
        confirmed = true;
        return true;
      },
      buildMissingAgent: async () => {
        if (!confirmed) throw new Error('built before consent!');
        calls++;
        return 'web_fetch';
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('fetch a web page', deps);
    // Built exactly once: a regression that double-builds (or builds inside
    // the regeneration loop, before consent) would push this above 1 or
    // throw via the confirmed-guard above.
    expect(calls).toBe(1);
    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.builtAgents).toContain('web_fetch');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns invalid with a goal-alignment issue when the judge rejects both attempts', async () => {
  const { root, paths } = tmpPaths();
  try {
    const planNodesObj = {
      steps: [{ id: 'a', kind: 'agent', agent: 'web_fetch' }],
    };
    const planEdgesObj = {
      id: 'wf',
      steps: [
        {
          kind: 'agent',
          id: 'a',
          agent: 'web_fetch',
          input: { kind: 'fromInput' },
        },
      ],
    };
    const judgeRejects = { aligned: false, reason: 'does not accomplish' };
    let buildCalls = 0;
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        planNodesObj, // attempt 0: plan-nodes
        planEdgesObj, // attempt 0: plan-edges (the IR)
        judgeRejects, // attempt 0: goal-alignment
        planNodesObj, // attempt 1: plan-nodes
        planEdgesObj, // attempt 1: plan-edges (the IR)
        judgeRejects, // attempt 1: goal-alignment
      ]),
      existingAgents: () => ['web_fetch'],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => {
        throw new Error(
          'should not be called: an invalid IR never reaches consent',
        );
      },
      buildMissingAgent: async () => {
        buildCalls++;
        throw new Error(
          'should not be called: an invalid IR never reaches build',
        );
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('x', deps);
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') {
      expect(r.issues.some((i) => i.field === 'goal-alignment')).toBe(true);
    }
    expect(buildCalls).toBe(0);
    expect(existsSync(join(paths.workflowsDir, 'wf.ts'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retries and succeeds after generation throws on the first attempt', async () => {
  const { root, paths } = tmpPaths();
  try {
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        new Error('model returned unparseable JSON'), // attempt 0: plan-nodes throws
        { steps: [{ id: 'a', kind: 'agent', agent: 'web_fetch' }] }, // attempt 1: plan-nodes
        {
          id: 'wf',
          steps: [
            {
              kind: 'agent',
              id: 'a',
              agent: 'web_fetch',
              input: { kind: 'fromInput' },
            },
          ],
        }, // attempt 1: plan-edges (the IR)
        { aligned: true, reason: 'ok' }, // attempt 1: goal-alignment
      ]),
      existingAgents: () => ['web_fetch'],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => true,
      buildMissingAgent: async () => {
        throw new Error('should not be called: agent already exists');
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('x', deps);
    expect(r.kind).toBe('written');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns invalid (not a rejection) when generation throws on every attempt', async () => {
  const { root, paths } = tmpPaths();
  try {
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        new Error('model returned unparseable JSON'), // attempt 0: plan-nodes throws
        new Error('model returned unparseable JSON'), // attempt 1: plan-nodes throws
      ]),
      existingAgents: () => ['web_fetch'],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => {
        throw new Error(
          'should not be called: generation never produced an IR',
        );
      },
      buildMissingAgent: async () => {
        throw new Error(
          'should not be called: generation never produced an IR',
        );
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    // Must resolve to an 'invalid' result, not reject the promise — the
    // catch branch around plan-nodes/plan-edges converts a throw into a
    // 'generation' validation issue (Slice 19 close-review Finding 3).
    const r = await buildCrewOrWorkflow('x', deps);
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') {
      expect(r.issues.some((i) => i.field === 'generation')).toBe(true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns abandoned when a required agent build is declined/fails', async () => {
  const { root, paths } = tmpPaths();
  try {
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        { steps: [{ id: 'a', kind: 'agent', agent: 'web_fetch' }] }, // plan-nodes
        {
          id: 'wf',
          steps: [
            {
              kind: 'agent',
              id: 'a',
              agent: 'web_fetch',
              input: { kind: 'fromInput' },
            },
          ],
        }, // plan-edges (the IR)
        { aligned: true, reason: 'ok' }, // goal-alignment
      ]),
      existingAgents: () => [],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => true,
      buildMissingAgent: async () => null,
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('x', deps);
    expect(r.kind).toBe('abandoned');
    expect(existsSync(join(paths.workflowsDir, 'wf.ts'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns abandoned (not a rejection) when a required agent build THROWS', async () => {
  const { root, paths } = tmpPaths();
  try {
    const deps: CrewBuilderDeps = {
      model: scriptedModel([
        { shape: 'workflow' }, // classify
        { steps: [{ id: 'a', kind: 'agent', agent: 'web_fetch' }] }, // plan-nodes
        {
          id: 'wf',
          steps: [
            {
              kind: 'agent',
              id: 'a',
              agent: 'web_fetch',
              input: { kind: 'fromInput' },
            },
          ],
        }, // plan-edges (the IR)
        { aligned: true, reason: 'ok' }, // goal-alignment
      ]),
      existingAgents: () => [],
      packNames: () => [],
      existingCrews: () => [],
      existingWorkflows: () => [],
      confirm: async () => true,
      // The live agent-builder's generateProposal THROWS when the model
      // can't return valid JSON after its own retries; the crew-builder must
      // fold that into an 'abandoned' result, not reject the whole call
      // (Slice 19 close-review: same throw-vs-result-kind gap as Finding 3,
      // in the post-consent build stage — reproduced live before the fix).
      buildMissingAgent: async () => {
        throw new Error('agent-builder: model did not return valid JSON');
      },
      paths,
      agentPaths: {
        agentsDir: 'agents',
        indexPath: 'agents/index.ts',
        mcpConfigPath: 'mcp.json',
      },
    };
    const r = await buildCrewOrWorkflow('x', deps);
    expect(r.kind).toBe('abandoned');
    if (r.kind === 'abandoned') {
      expect(r.reason).toContain('agent build failed');
    }
    expect(existsSync(join(paths.workflowsDir, 'wf.ts'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
