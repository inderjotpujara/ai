// tests/crew-builder/gate-integration.test.ts
//
// All-hermetic tests for the reuse-check -> generate -> consent -> auto-build
// members -> stage -> verify -> commit gate (CrewBuilderDeps.verify present).
// Mirrors tests/agent-builder/gate-integration.test.ts.
//
// The gate's `stage()` dynamically imports the staged def file (per spec),
// and the transpiled source's relative imports (`../src/workflow/define.ts`
// etc.) assume the def file lives exactly one directory below the repo
// root — same assumption the real `crews/`/`workflows/` dirs satisfy. So the
// fresh-build/failing-dry-run tests below place their tmp crews/workflows
// dirs as DIRECT children of the repo root (via `mkdtempSync(join(cwd(),
// '.tmp-gate-...'))`), not under the system tmpdir, and clean them up in a
// finally block. The reuse-hit test never stages anything (it short-circuits
// before generation), so it uses a plain system-tmpdir directory.
import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync as mkdtempSyncNode,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { buildCrewOrWorkflow } from '../../src/crew-builder/builder.ts';
import type {
  CrewBuilderDeps,
  CrewBuilderVerifyDeps,
} from '../../src/crew-builder/types.ts';
import {
  readManifest,
  upsertEntry,
} from '../../src/verified-build/manifest.ts';
import type {
  ManifestEntry,
  VerifiedWith,
} from '../../src/verified-build/types.ts';
import {
  GoldenKind,
  ReuseKind,
  VerifiedLevel,
} from '../../src/verified-build/types.ts';

const INDEX_STUB =
  'export const X = {\n  // CREW-BUILDER:ENTRIES\n};\n// CREW-BUILDER:IMPORTS\n';

/** A prompt-dispatching fake `BuilderModel` covering every structured call
 *  the gated `buildCrewOrWorkflow` path makes: need->signature distillation
 *  (reuse-check), classify, plan-nodes, plan-edges, goal-alignment, and
 *  golden-case generation. `planCalls()` lets the reuse-hit test assert the
 *  generator was never reached. */
function fakeModel(opts: {
  shape?: 'crew' | 'workflow';
  nodes?: unknown;
  ir?: unknown;
}): {
  model: BuilderModel;
  planCalls: () => number;
  goldenCalls: () => number;
  planPrompts: () => string[];
} {
  let planCalls = 0;
  let goldenCalls = 0;
  const planPrompts: string[] = [];
  const shape = opts.shape ?? 'workflow';
  const model: BuilderModel = {
    object: async ({ prompt }) => {
      if (prompt.includes('Decide whether the need below is better served')) {
        return { shape } as never;
      }
      if (prompt.includes('Distill this need into a capability signature')) {
        return { purpose: 'runs a fresh flow', tools: ['fetch'] } as never;
      }
      if (prompt.includes('list the NODES only')) {
        planCalls += 1;
        planPrompts.push(prompt);
        return (opts.nodes ?? {
          steps: [{ id: 'f', kind: 'tool', tool: 'fetch' }],
        }) as never;
      }
      if (prompt.includes('Wire the workflow: produce the full workflow IR')) {
        return (opts.ir ?? {
          id: 'fresh_flow',
          steps: [
            {
              kind: 'tool',
              id: 'f',
              tool: 'fetch',
              input: { kind: 'fromInput' },
            },
          ],
        }) as never;
      }
      if (
        prompt.includes(
          'Does the plan below actually accomplish the stated need',
        )
      ) {
        return { aligned: true, reason: 'ok' } as never;
      }
      if (prompt.includes('Generate 3 to 7 golden test cases')) {
        goldenCalls += 1;
        return {
          cases: [
            {
              input: 'run the flow',
              assert: 'the output is non-empty',
              kind: GoldenKind.TaskSuccess,
            },
          ],
        } as never;
      }
      throw new Error(`fakeModel: unrecognized prompt: ${prompt.slice(0, 80)}`);
    },
    text: async () => 'plan',
  };
  return {
    model,
    planCalls: () => planCalls,
    goldenCalls: () => goldenCalls,
    planPrompts: () => planPrompts,
  };
}

function manifestEntry(vector: number[]): ManifestEntry {
  return {
    need: 'seed',
    signature: { purpose: 'seed', tools: [], modelTier: '', io: '', roles: [] },
    vector,
    verifiedLevel: VerifiedLevel.Behaves,
    goldenPath: 'workflows/existing_flow.golden.json',
    createdAtMs: 1,
    lastUsedMs: 2,
    useCount: 3,
    lastEvalPass: true,
  };
}

/** System-tmpdir paths — fine for the reuse-hit case, which short-circuits
 *  before any file is staged/imported. */
function tmpdirPaths(): {
  paths: CrewBuilderDeps['paths'];
  workflowsDir: string;
} {
  const root = mkdtempSyncNode(join(tmpdir(), 'cwb-gate-'));
  const crewsDir = join(root, 'crews');
  const workflowsDir = join(root, 'workflows');
  mkdirSync(crewsDir);
  mkdirSync(workflowsDir);
  return {
    paths: {
      crewsDir,
      crewsIndexPath: join(crewsDir, 'index.ts'),
      workflowsDir,
      workflowsIndexPath: join(workflowsDir, 'index.ts'),
    },
    workflowsDir,
  };
}

/** Repo-root-adjacent tmp dirs — REQUIRED for any test that reaches staging:
 *  the transpiled file's `../src/...` imports only resolve when the def file
 *  sits exactly one directory below the repo root, matching the real
 *  `crews/`/`workflows/` layout. Returns a `cleanup()` that removes both. */
function repoRootPaths(): {
  paths: CrewBuilderDeps['paths'];
  workflowsDir: string;
  cleanup: () => void;
} {
  const crewsDir = mkdtempSyncNode(join(process.cwd(), '.tmp-gate-crews-'));
  const workflowsDir = mkdtempSyncNode(
    join(process.cwd(), '.tmp-gate-workflows-'),
  );
  const crewsIndexPath = join(crewsDir, 'index.ts');
  const workflowsIndexPath = join(workflowsDir, 'index.ts');
  writeFileSync(crewsIndexPath, INDEX_STUB);
  writeFileSync(workflowsIndexPath, INDEX_STUB);
  return {
    paths: { crewsDir, crewsIndexPath, workflowsDir, workflowsIndexPath },
    workflowsDir,
    cleanup: () => {
      rmSync(crewsDir, { recursive: true, force: true });
      rmSync(workflowsDir, { recursive: true, force: true });
    },
  };
}

function baseDeps(
  paths: CrewBuilderDeps['paths'],
  model: BuilderModel,
  verify: CrewBuilderVerifyDeps,
): CrewBuilderDeps {
  return {
    model,
    existingAgents: () => [],
    packNames: () => ['fetch'],
    existingCrews: () => [],
    existingWorkflows: () => [],
    confirm: async () => true,
    buildMissingAgent: async () => {
      throw new Error('should not be called: this need references no agent');
    },
    paths,
    agentPaths: {
      agentsDir: 'agents',
      indexPath: 'agents/index.ts',
      mcpConfigPath: 'mcp.json',
    },
    verify,
  };
}

function fakeVerify(
  overrides: Partial<CrewBuilderVerifyDeps> = {},
): CrewBuilderVerifyDeps {
  return {
    embed: async (texts) => texts.map(() => [0, 1]),
    judgeCandidates: () => [
      { model: 'judge-big', params: 30e9, family: 'other-family' },
    ],
    runArtifact: async () => ({ text: 'ran the flow' }),
    judge: async () => true,
    ...overrides,
  };
}

test('reuse hit: returns {kind:"reused"} and never calls the generator', async () => {
  const { paths, workflowsDir } = tmpdirPaths();
  const { model, planCalls } = fakeModel({});
  const deps = baseDeps(paths, model, fakeVerify());
  // Seed a manifest entry whose vector is identical to what the fake `embed`
  // produces for ANY text — cosine 1.0, well above the reuse band.
  upsertEntry(workflowsDir, 'existing_flow', manifestEntry([0, 1]));

  const r = await buildCrewOrWorkflow('need already covered', deps);

  expect(r.kind).toBe('reused');
  if (r.kind === 'reused') {
    expect(r.name).toBe('existing_flow');
    expect(r.similarity).toBeCloseTo(1.0);
  }
  expect(planCalls()).toBe(0);
});

test('fresh workflow, passing gate: writes at VerifiedLevel.Behaves and registers it', async () => {
  const { paths, workflowsDir, cleanup } = repoRootPaths();
  try {
    const { model } = fakeModel({});
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({ runArtifact: async () => ({ text: 'ran the flow' }) }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.shape).toBe('workflow');
      expect(r.name).toBe('fresh_flow');
      expect(r.level).toBe(VerifiedLevel.Behaves);
    }
    const idx = readFileSync(paths.workflowsIndexPath, 'utf8');
    expect(idx).toContain('[freshFlow.id]: freshFlow,');
    const manifest = readManifest(workflowsDir);
    expect(manifest.entries.fresh_flow?.verifiedLevel).toBe(
      VerifiedLevel.Behaves,
    );
  } finally {
    cleanup();
  }
});

test('reuse hit DECLINED via confirmReuse: falls through to generation', async () => {
  const { paths, workflowsDir, cleanup } = repoRootPaths();
  try {
    const asked: ReuseKind[] = [];
    const { model, planCalls } = fakeModel({});
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({
        confirmReuse: async (kind) => {
          asked.push(kind);
          return false;
        },
      }),
    );
    upsertEntry(workflowsDir, 'existing_flow', manifestEntry([0, 1]));

    const r = await buildCrewOrWorkflow('need already covered', deps);

    expect(asked).toEqual([ReuseKind.Reuse]);
    expect(planCalls()).toBe(1);
    expect(r.kind).toBe('written');
  } finally {
    cleanup();
  }
});

test('offer band (0.75–0.85) accepted via confirmReuse: reused, nothing generated', async () => {
  const { paths, workflowsDir } = tmpdirPaths();
  const asked: ReuseKind[] = [];
  const { model, planCalls } = fakeModel({});
  const deps = baseDeps(
    paths,
    model,
    fakeVerify({
      confirmReuse: async (kind) => {
        asked.push(kind);
        return true;
      },
    }),
  );
  // embed yields [0, 1] for any text; cosine([0,1],[0.6,0.8]) = 0.8 —
  // inside the offer band (0.75–0.85).
  upsertEntry(workflowsDir, 'close_flow', manifestEntry([0.6, 0.8]));

  const r = await buildCrewOrWorkflow('a close-but-not-identical need', deps);

  expect(asked).toEqual([ReuseKind.Offer]);
  expect(r.kind).toBe('reused');
  if (r.kind === 'reused') {
    expect(r.name).toBe('close_flow');
    expect(r.similarity).toBeCloseTo(0.8);
  }
  expect(planCalls()).toBe(0);
});

test('generates the golden set exactly ONCE — the persisted set is the evaluated set', async () => {
  const { paths, workflowsDir, cleanup } = repoRootPaths();
  try {
    const { model, goldenCalls } = fakeModel({});
    const deps = baseDeps(paths, model, fakeVerify());

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('written');
    expect(goldenCalls()).toBe(1);
    const persisted = JSON.parse(
      readFileSync(join(workflowsDir, 'fresh_flow.golden.json'), 'utf8'),
    ) as { cases: unknown[] };
    expect(persisted.cases).toHaveLength(1);
  } finally {
    cleanup();
  }
});

test('below-bar judge generates NO golden set and commits at runs', async () => {
  const { paths, cleanup } = repoRootPaths();
  try {
    const { model, goldenCalls } = fakeModel({});
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({
        judgeCandidates: () => [
          { model: 'too-small', params: 3e9, family: 'other-family' },
        ],
      }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.level).toBe(VerifiedLevel.Runs);
    }
    expect(goldenCalls()).toBe(0);
  } finally {
    cleanup();
  }
});

test('golden-eval judge runs on the model selectJudge picked, not the generator', async () => {
  const { paths, cleanup } = repoRootPaths();
  try {
    const judgeIds: string[] = [];
    const { model } = fakeModel({});
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({
        judgeCandidates: () => [
          { model: 'judge-big', params: 30e9, family: 'other-family' },
          { model: 'generator-twin', params: 30e9, family: 'gen-family' },
        ],
        generatorFamily: 'gen-family',
        judge: async (_prompt, judgeModelId) => {
          judgeIds.push(judgeModelId);
          return true;
        },
      }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('written');
    expect(judgeIds.length).toBeGreaterThan(0);
    // Every judge call carries the cross-family pick — never the same-family twin.
    expect(new Set(judgeIds)).toEqual(new Set(['judge-big']));
  } finally {
    cleanup();
  }
});

test('commit persists verifiedWith from the resolved model pick', async () => {
  const { paths, workflowsDir, cleanup } = repoRootPaths();
  try {
    const { model } = fakeModel({});
    const fakeVerifiedWith: VerifiedWith = {
      runtime: RuntimeKind.Ollama,
      model: 'A:7b',
      paramsBillions: 7,
      numCtx: 8192,
      capturedAtMs: 1,
    };
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({ verifiedWith: fakeVerifiedWith }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('written');
    const manifest = readManifest(workflowsDir);
    expect(manifest.entries.fresh_flow?.verifiedWith?.model).toBe('A:7b');
  } finally {
    cleanup();
  }
});

test('a failed dry-run feeds the RUNTIME error back into a re-plan (repair)', async () => {
  const { paths, cleanup } = repoRootPaths();
  try {
    const { model, planCalls, planPrompts } = fakeModel({});
    let runs = 0;
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({
        // First dry-run fails with a concrete runtime error; the repaired
        // (re-planned) workflow then passes.
        runArtifact: async () => {
          runs += 1;
          return runs === 1
            ? { error: 'boom: step exploded at runtime' }
            : { text: 'ran the flow' };
        },
      }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('written');
    // One consented plan + one repair re-plan...
    expect(planCalls()).toBe(2);
    // ...and the re-plan prompt carried the REAL dry-run error (I6).
    expect(planPrompts()[1]).toContain('boom: step exploded at runtime');
  } finally {
    cleanup();
  }
});

test('hung dry-run: bounded by AGENT_DRY_RUN_MS — fails with a timeout, does not hang', async () => {
  process.env.AGENT_DRY_RUN_MS = '50';
  process.env.AGENT_BUILD_MAX_REPAIRS = '1';
  const { paths, workflowsDir, cleanup } = repoRootPaths();
  try {
    const { model } = fakeModel({});
    const deps = baseDeps(
      paths,
      model,
      // A run that never resolves — the wall clock must win.
      fakeVerify({ runArtifact: () => new Promise(() => {}) }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('failed-verification');
    if (r.kind === 'failed-verification') {
      expect(r.stage).toBe('dry-run');
      expect(r.detail).toContain('timeout');
    }
    const manifest = readManifest(workflowsDir);
    expect(manifest.entries.fresh_flow).toBeUndefined();
  } finally {
    delete process.env.AGENT_DRY_RUN_MS;
    delete process.env.AGENT_BUILD_MAX_REPAIRS;
    cleanup();
  }
});

test('failing dry-run, force false: fails verification and registers nothing', async () => {
  const { paths, workflowsDir, cleanup } = repoRootPaths();
  try {
    const { model } = fakeModel({});
    const deps = baseDeps(
      paths,
      model,
      fakeVerify({
        runArtifact: async () => ({ error: 'boom: workflow could not run' }),
        force: false,
      }),
    );

    const r = await buildCrewOrWorkflow('run a fresh flow', deps);

    expect(r.kind).toBe('failed-verification');
    if (r.kind === 'failed-verification') {
      expect(r.stage).toBe('dry-run');
    }
    const idx = readFileSync(paths.workflowsIndexPath, 'utf8');
    expect(idx).not.toContain('fresh_flow');
    const manifest = readManifest(workflowsDir);
    expect(manifest.entries.fresh_flow).toBeUndefined();
    // The staged (unregistered) file was discarded — nothing broken lingers
    // to trip the next typecheck/lint (I2).
    expect(existsSync(join(workflowsDir, 'fresh_flow.ts'))).toBe(false);
  } finally {
    cleanup();
  }
});
