import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent } from '../../src/agent-builder/builder.ts';
import type {
  BuilderDeps,
  BuilderModel,
  BuilderVerifyDeps,
} from '../../src/agent-builder/types.ts';
import { JudgeUnavailableError } from '../../src/verified-build/judge.ts';
import {
  readManifest,
  upsertEntry,
} from '../../src/verified-build/manifest.ts';
import type { ManifestEntry } from '../../src/verified-build/types.ts';
import {
  GoldenKind,
  ReuseKind,
  VerifiedLevel,
} from '../../src/verified-build/types.ts';

/** All-hermetic tests for the reuse-check → generate → consent → stage →
 *  verify → commit gate (BuilderDeps.verify present). Mirrors the
 *  `INDEX_SEED` fixture from builder.test.ts. */
const INDEX_SEED = `import type { ToolSet } from 'ai';
import type { Agent } from '../src/core/agent-def.ts';
// AGENT-BUILDER:IMPORTS (generated agent imports are inserted above this line — do not remove)
export type AgentFactory = (tools: ToolSet) => Agent;
export const AGENTS: Record<string, AgentFactory> = {
  // AGENT-BUILDER:ENTRIES (generated agent entries are inserted above this line — do not remove)
};
`;

type Draft = {
  name: string;
  description: string;
  systemPrompt: string;
  role: string;
  rationale: string;
};

const DEFAULT_DRAFT: Draft = {
  name: 'fresh_agent',
  description: 'Does a fresh thing.',
  systemPrompt: 'You do a fresh thing.',
  role: 'fresh',
  rationale: 'no such agent exists',
};

/** A prompt-dispatching fake `BuilderModel` covering every structured call
 *  the gated `buildAgent` path makes: need→signature distillation
 *  (reuse-check), draft generation, server suggestion, and golden-case
 *  generation. `draftCalls()` lets a reuse-hit test assert the generator was
 *  never reached. */
function fakeModel(opts: { draft?: Draft; servers?: string[] }): {
  model: BuilderModel;
  draftCalls: () => number;
  goldenCalls: () => number;
  draftPrompts: () => string[];
} {
  let draftCalls = 0;
  let goldenCalls = 0;
  const draftPrompts: string[] = [];
  const draft = opts.draft ?? DEFAULT_DRAFT;
  const servers = opts.servers ?? [];
  const model: BuilderModel = {
    object: async ({ prompt }) => {
      if (prompt.includes('Distill this need')) {
        return { purpose: 'does a fresh thing', tools: [] } as never;
      }
      if (prompt.includes('Design a single specialized sub-agent')) {
        draftCalls += 1;
        draftPrompts.push(prompt);
        return draft as never;
      }
      if (prompt.includes('Choose the MINIMAL set of MCP servers')) {
        return { servers } as never;
      }
      if (prompt.includes('golden test cases')) {
        goldenCalls += 1;
        return {
          cases: [
            {
              input: 'do the fresh thing',
              assert: 'the response addresses the thing',
              kind: GoldenKind.TaskSuccess,
            },
          ],
        } as never;
      }
      throw new Error(`fakeModel: unrecognized prompt: ${prompt.slice(0, 80)}`);
    },
    text: async () => '',
  };
  return {
    model,
    draftCalls: () => draftCalls,
    goldenCalls: () => goldenCalls,
    draftPrompts: () => draftPrompts,
  };
}

function manifestEntry(vector: number[]): ManifestEntry {
  return {
    need: 'seed',
    signature: { purpose: 'seed', tools: [], modelTier: '', io: '', roles: [] },
    vector,
    verifiedLevel: VerifiedLevel.Behaves,
    goldenPath: 'agents/existing_agent.golden.json',
    createdAtMs: 1,
    lastUsedMs: 2,
    useCount: 3,
    lastEvalPass: true,
  };
}

async function makeDeps(opts: {
  model: BuilderModel;
  verify: Partial<BuilderVerifyDeps>;
  confirm?: boolean;
  existingNames?: string[];
}): Promise<{ deps: BuilderDeps; agentsDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ab-gate-'));
  const agentsDir = join(dir, 'agents');
  await Bun.write(join(agentsDir, 'index.ts'), INDEX_SEED);
  const verify: BuilderVerifyDeps = {
    embed: async (texts) => texts.map(() => [0, 1]),
    judgeCandidates: () => [
      { model: 'judge-big', params: 30e9, family: 'other-family' },
    ],
    runAgent: async () => ({ text: 'did the fresh thing' }),
    judge: async () => true,
    dir: agentsDir,
    ...opts.verify,
  };
  const deps: BuilderDeps = {
    model: opts.model,
    existingNames: () => opts.existingNames ?? [],
    packNames: () => ['filesystem'],
    confirm: async () => opts.confirm ?? true,
    paths: {
      agentsDir,
      indexPath: join(agentsDir, 'index.ts'),
      mcpConfigPath: join(dir, 'mcp.json'),
    },
    verify,
  };
  return { deps, agentsDir };
}

describe('buildAgent — verify-then-commit gate (deps.verify present)', () => {
  it('reuse hit: returns {kind:"reused"} and never calls the generator', async () => {
    const { model, draftCalls } = fakeModel({});
    const { deps, agentsDir } = await makeDeps({ model, verify: {} });
    // Seed a manifest entry whose vector is identical to what the fake
    // `embed` produces for ANY text — cosine 1.0, well above the reuse band.
    upsertEntry(agentsDir, 'existing_agent', manifestEntry([0, 1]));

    const r = await buildAgent('need already covered', deps);

    expect(r.kind).toBe('reused');
    if (r.kind === 'reused') {
      expect(r.name).toBe('existing_agent');
      expect(r.similarity).toBeCloseTo(1.0);
    }
    expect(draftCalls()).toBe(0);
    const idx = await readFile(deps.paths.indexPath, 'utf8');
    expect(idx).not.toContain('createFreshAgentAgent');
  });

  it('reuse hit DECLINED via confirmReuse: falls through to generation', async () => {
    const asked: ReuseKind[] = [];
    const { model, draftCalls } = fakeModel({});
    const { deps, agentsDir } = await makeDeps({
      model,
      verify: {
        confirmReuse: async (kind) => {
          asked.push(kind);
          return false;
        },
      },
    });
    upsertEntry(agentsDir, 'existing_agent', manifestEntry([0, 1]));

    const r = await buildAgent('need already covered', deps);

    expect(asked).toEqual([ReuseKind.Reuse]);
    expect(draftCalls()).toBe(1);
    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.proposal.name).toBe('fresh_agent');
    }
  });

  it('offer band (0.75–0.85) accepted via confirmReuse: reused, nothing generated', async () => {
    const asked: ReuseKind[] = [];
    const { model, draftCalls } = fakeModel({});
    const { deps, agentsDir } = await makeDeps({
      model,
      verify: {
        confirmReuse: async (kind) => {
          asked.push(kind);
          return true;
        },
      },
    });
    // embed yields [0, 1] for any text; cosine([0,1],[0.6,0.8]) = 0.8 —
    // inside the offer band (0.75–0.85).
    upsertEntry(agentsDir, 'close_agent', manifestEntry([0.6, 0.8]));

    const r = await buildAgent('a close-but-not-identical need', deps);

    expect(asked).toEqual([ReuseKind.Offer]);
    expect(r.kind).toBe('reused');
    if (r.kind === 'reused') {
      expect(r.name).toBe('close_agent');
      expect(r.similarity).toBeCloseTo(0.8);
    }
    expect(draftCalls()).toBe(0);
  });

  it('offer band declined via confirmReuse: generates a fresh agent', async () => {
    const { model, draftCalls } = fakeModel({});
    const { deps, agentsDir } = await makeDeps({
      model,
      verify: { confirmReuse: async () => false },
    });
    upsertEntry(agentsDir, 'close_agent', manifestEntry([0.6, 0.8]));

    const r = await buildAgent('a close-but-not-identical need', deps);

    expect(r.kind).toBe('written');
    expect(draftCalls()).toBe(1);
  });

  it('fresh need, passing gate: writes at VerifiedLevel.Behaves and registers the agent', async () => {
    const { model } = fakeModel({ servers: [] });
    const { deps } = await makeDeps({
      model,
      verify: {
        runAgent: async () => ({ text: 'did the fresh thing' }),
        judge: async () => true,
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.proposal.name).toBe('fresh_agent');
      expect(r.level).toBe(VerifiedLevel.Behaves);
    }
    const idx = await readFile(deps.paths.indexPath, 'utf8');
    expect(idx).toContain('fresh_agent: createFreshAgentAgent,');
    const manifest = readManifest(deps.verify?.dir ?? '');
    expect(manifest.entries.fresh_agent?.verifiedLevel).toBe(
      VerifiedLevel.Behaves,
    );
  });

  it('generates the golden set exactly ONCE — the persisted set is the evaluated set', async () => {
    const { model, goldenCalls } = fakeModel({});
    const { deps, agentsDir } = await makeDeps({ model, verify: {} });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    expect(goldenCalls()).toBe(1);
    const persisted = JSON.parse(
      await readFile(join(agentsDir, 'fresh_agent.golden.json'), 'utf8'),
    ) as { cases: unknown[] };
    expect(persisted.cases).toHaveLength(1);
  });

  it('below-bar judge generates NO golden set and commits at runs', async () => {
    const { model, goldenCalls } = fakeModel({});
    const { deps } = await makeDeps({
      model,
      verify: {
        judgeCandidates: () => [
          { model: 'too-small', params: 3e9, family: 'other-family' },
        ],
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.level).toBe(VerifiedLevel.Runs);
    }
    expect(goldenCalls()).toBe(0);
  });

  it('judge model that cannot be loaded degrades to runs, never crashes', async () => {
    const { model } = fakeModel({});
    const { deps } = await makeDeps({
      model,
      verify: {
        // A judge that CLEARS the param bar (so a golden set is generated and
        // eval is attempted) but whose model cannot be resolved/loaded at
        // grade time — the never-crash policy must degrade to `runs`.
        judgeCandidates: () => [
          { model: 'big-but-unloadable', params: 26e9, family: 'other-family' },
        ],
        judge: async () => {
          throw new JudgeUnavailableError('big-but-unloadable');
        },
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.level).toBe(VerifiedLevel.Runs);
    }
  });

  it('golden-eval judge runs on the model selectJudge picked, not the generator', async () => {
    const judgeIds: string[] = [];
    const { model } = fakeModel({});
    const { deps } = await makeDeps({
      model,
      verify: {
        judgeCandidates: () => [
          { model: 'judge-big', params: 30e9, family: 'other-family' },
          { model: 'generator-twin', params: 30e9, family: 'gen-family' },
        ],
        generatorFamily: 'gen-family',
        judge: async (_prompt, judgeModelId) => {
          judgeIds.push(judgeModelId);
          return true;
        },
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    expect(judgeIds.length).toBeGreaterThan(0);
    // Every judge call carries the cross-family pick — never the same-family twin.
    expect(new Set(judgeIds)).toEqual(new Set(['judge-big']));
  });

  it('failing dry-run, force false: fails verification and registers nothing', async () => {
    const { model } = fakeModel({});
    const { deps } = await makeDeps({
      model,
      verify: {
        runAgent: async () => ({ error: 'boom: agent could not run' }),
        force: false,
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('failed-verification');
    if (r.kind === 'failed-verification') {
      expect(r.stage).toBe('dry-run');
    }
    const idx = await readFile(deps.paths.indexPath, 'utf8');
    expect(idx).not.toContain('fresh_agent');
    const manifest = readManifest(deps.verify?.dir ?? '');
    expect(manifest.entries.fresh_agent).toBeUndefined();
    // The staged (unregistered) file was discarded — nothing broken lingers
    // to trip the next typecheck/lint (I2).
    expect(existsSync(join(deps.paths.agentsDir, 'fresh_agent.ts'))).toBe(
      false,
    );
  });

  it('a failed dry-run feeds the RUNTIME error back into a regeneration (repair)', async () => {
    const { model, draftCalls, draftPrompts } = fakeModel({});
    let runs = 0;
    const { deps } = await makeDeps({
      model,
      verify: {
        // First dry-run fails with a concrete runtime error; the repaired
        // (regenerated) proposal then passes.
        runAgent: async () => {
          runs += 1;
          return runs === 1
            ? { error: 'boom: tool exploded at runtime' }
            : { text: 'did the fresh thing' };
        },
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    // One consented draft + one repair regeneration...
    expect(draftCalls()).toBe(2);
    // ...and the regeneration prompt carried the REAL dry-run error (I6).
    expect(draftPrompts()[1]).toContain('boom: tool exploded at runtime');
  });

  it('hung dry-run: bounded by AGENT_DRY_RUN_MS — fails with a timeout, does not hang', async () => {
    process.env.AGENT_DRY_RUN_MS = '50';
    process.env.AGENT_BUILD_MAX_REPAIRS = '1';
    try {
      const { model } = fakeModel({});
      const signals: (AbortSignal | undefined)[] = [];
      const { deps } = await makeDeps({
        model,
        verify: {
          // A model call that never resolves — the wall clock must win.
          runAgent: (_agent, _task, signal) => {
            signals.push(signal);
            return new Promise(() => {});
          },
        },
      });

      const r = await buildAgent('do a fresh thing', deps);

      expect(r.kind).toBe('failed-verification');
      if (r.kind === 'failed-verification') {
        expect(r.stage).toBe('dry-run');
        expect(r.detail).toContain('timeout');
      }
      // The runner also received an AbortSignal so the hung generateText
      // itself gets aborted, not just raced.
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      const idx = await readFile(deps.paths.indexPath, 'utf8');
      expect(idx).not.toContain('fresh_agent');
    } finally {
      delete process.env.AGENT_DRY_RUN_MS;
      delete process.env.AGENT_BUILD_MAX_REPAIRS;
    }
  });

  it('force true on a failing dry-run: commits at VerifiedLevel.Unverified', async () => {
    const { model } = fakeModel({});
    const { deps } = await makeDeps({
      model,
      verify: {
        runAgent: async () => ({ error: 'boom: agent could not run' }),
        force: true,
      },
    });

    const r = await buildAgent('do a fresh thing', deps);

    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.level).toBe(VerifiedLevel.Unverified);
    }
    const idx = await readFile(deps.paths.indexPath, 'utf8');
    expect(idx).toContain('fresh_agent: createFreshAgentAgent,');
  });
});
