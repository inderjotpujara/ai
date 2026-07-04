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
  mkdirSync,
  mkdtempSync as mkdtempSyncNode,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { buildCrewOrWorkflow } from '../../src/crew-builder/builder.ts';
import type {
  CrewBuilderDeps,
  CrewBuilderVerifyDeps,
} from '../../src/crew-builder/types.ts';
import {
  readManifest,
  upsertEntry,
} from '../../src/verified-build/manifest.ts';
import type { ManifestEntry } from '../../src/verified-build/types.ts';
import { GoldenKind, VerifiedLevel } from '../../src/verified-build/types.ts';

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
}): { model: BuilderModel; planCalls: () => number } {
  let planCalls = 0;
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
  return { model, planCalls: () => planCalls };
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
  } finally {
    cleanup();
  }
});
