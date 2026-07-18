## Task 12: Builder registry lists + `runBuilderTurn` wiring (`ServerDeps`, `app.ts`, `main.ts`)

**Files:**
- Create: `src/server/builders/list.ts`
- Modify: `src/server/launch-turns.ts` (add `createRealRunBuilderTurn`)
- Modify: `src/server/app.ts` (extend `ServerDeps` with `runBuilderTurn`; wire three routes: `GET /api/builders/agents`, `GET /api/builders/crews`, `POST /api/builders/build`)
- Modify: `src/server/main.ts` (build the real turn; add to the `deps` object)
- Modify (fixture ripple — `ServerDeps` gained a required field): `tests/server/app.test.ts` (four `ServerDeps` literals, lines ~32/99/140/235), `tests/server/runs-routes.test.ts` (one literal), `tests/server/phase4-routes.test.ts` (the shared `deps()` helper)
- Test: `tests/server/builders-list.test.ts` (create), `tests/server/builders-turn.test.ts` (create — the requirement-(d) span-closes-on-disconnect proof deferred out of Task 11)

**Interfaces:**
- Consumes: `RunBuilderTurn` (Task 11), `agentNames` (`agents/index.ts`), `CREWS` (`crews/index.ts`), `WORKFLOWS` (`workflows/index.ts`), `BuilderRegistryListResponseSchema` (Task 6), `makeRealBuilderDeps` (`src/agent-builder/deps.ts`), `makeRealCrewBuilderDeps` (`src/crew-builder/deps.ts`), `withRunTelemetry` (`src/cli/with-run.ts`), `toBuildResultDto`/`toCrewBuildResultDto` (Task 10), `buildAgent`/`buildCrewOrWorkflow`.
- Produces: `handleBuilderAgentList(): Response`, `handleBuilderCrewList(): Response`, `createRealRunBuilderTurn(runsRoot: string): RunBuilderTurn`, `ServerDeps.runBuilderTurn: RunBuilderTurn`.

- [ ] **Step 1: Write the failing list-handler test**

`tests/server/builders-list.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { BuilderRegistryListResponse } from '../../src/contracts/index.ts';
import { handleBuilderAgentList, handleBuilderCrewList } from '../../src/server/builders/list.ts';

test('GET /api/builders/agents lists the agent registry', async () => {
  const res = handleBuilderAgentList();
  expect(res.status).toBe(200);
  const body = (await res.json()) as BuilderRegistryListResponse;
  expect(body.items.some((n) => n === 'file_qa')).toBe(true);
});

test('GET /api/builders/crews lists BOTH the crew and workflow registries', async () => {
  const res = handleBuilderCrewList();
  const body = (await res.json()) as BuilderRegistryListResponse;
  expect(body.items).toContain('research-crew');
  expect(body.items).toContain('fetch-then-summarize');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/builders-list.test.ts`
Expected: FAIL — module not found. (If `file_qa`/`research-crew`/`fetch-then-summarize` are not the real registry names in this checkout, read `agents/index.ts`/`crews/index.ts`/`workflows/index.ts` first and substitute the actual ones — this mirrors Phase 4's Task 8/9 fixtures, which already assert against these same names.)

- [ ] **Step 3: Create `src/server/builders/list.ts`**

```typescript
import { agentNames } from '../../../agents/index.ts';
import { CREWS } from '../../../crews/index.ts';
import { WORKFLOWS } from '../../../workflows/index.ts';
import { BuilderRegistryListResponseSchema } from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/builders/agents` — existing agent names, for the wizard's
 *  reuse/name-collision awareness (spec §4.2 item 2). */
export function handleBuilderAgentList(): Response {
  return json(
    BuilderRegistryListResponseSchema.parse({ items: agentNames() }),
    200,
  );
}

/** `GET /api/builders/crews` — existing crew AND workflow names (the
 *  crew-builder classifies a need into either shape, so the wizard needs
 *  awareness of both registries from one call). */
export function handleBuilderCrewList(): Response {
  const items = [...Object.keys(CREWS), ...Object.keys(WORKFLOWS)];
  return json(BuilderRegistryListResponseSchema.parse({ items }), 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/builders-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing real-turn + span-lifecycle test**

`tests/server/builders-turn.test.ts` — this is requirement (d) from spec §7.1, deferred out of Task 11: proves that a build's `agent.build` span (opened by `buildAgent` via `withAgentBuildSpan`, nested inside `withRunTelemetry`) closes normally even though the route that will eventually call this turn is stream-based and the client may disconnect — `createRealRunBuilderTurn` itself has no dependency on the HTTP request/response lifecycle at all, which IS the fix (the build is never given `req.signal`, so nothing about the connection can tear it down mid-stage):
```typescript
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuilderKind } from '../../src/contracts/enums.ts';
import { createRealRunBuilderTurn } from '../../src/server/launch-turns.ts';

test('createRealRunBuilderTurn runs a real agent build to completion and its agent.build span closes (spans.jsonl is non-empty after settling)', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'builder-turn-'));
  try {
    const turn = createRealRunBuilderTurn(runsRoot);
    const result = await turn({
      kind: BuilderKind.Agent,
      need: 'a trivial capability the builder will decline',
      runId: 'run-test-decline',
      confirm: async () => false, // decline immediately — no live model call needed to prove span closure
      confirmReuse: async () => false,
      log: () => {},
    });
    expect(result.kind).toBe('declined');
    const spansPath = join(runsRoot, 'run-test-decline', 'spans.jsonl');
    const raw = await readFile(spansPath, 'utf8');
    expect(raw).toContain('"name":"agent.build"');
  } finally {
    await rm(runsRoot, { recursive: true, force: true });
  }
});
```
**Note for the implementer:** this test still resolves a real `LanguageModel` via `makeRealBuilderDeps` (model manager + registry), so it needs a reachable Ollama daemon — same live-dependency class as the CLI's own `agent-builder.ts` `main()`. If no local model is reachable in CI, mark this test `test.skip` behind an env guard (e.g. `process.env.OLLAMA_HOST ? test : test.skip`) mirroring how other live-model tests in this repo degrade, and rely on the live-verify pass (Increment 6) to exercise it for real. Do not delete the test — skip it explicitly and note why.

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/server/builders-turn.test.ts`
Expected: FAIL — `createRealRunBuilderTurn` not exported from `launch-turns.ts`.

- [ ] **Step 7: Add `createRealRunBuilderTurn` to `src/server/launch-turns.ts`**

Read the file first (it currently exports `createRealRunCrewTurn`/`createRealRunWorkflowTurn`). Add:
```typescript
import type { BuilderDeps } from '../agent-builder/types.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import { withRunTelemetry } from '../cli/with-run.ts';
import { BuilderKind } from '../contracts/enums.ts';
import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';
import type { CrewBuilderDeps } from '../crew-builder/types.ts';
import type { RunBuilderTurn } from './builders/build.ts';
import { toBuildResultDto, toCrewBuildResultDto } from './builders/map-result.ts';

/**
 * Real, non-test `RunBuilderTurn`: reuses `withRunTelemetry` (NOT
 * `withMcpRun` — neither `buildAgent` nor `buildCrewOrWorkflow` mounts MCP
 * tools at dry-run time, D4/§4.2 item 1) so the run's spans (including
 * `agent.build`/`crew.build`, opened by `buildAgent`/`buildCrewOrWorkflow`
 * themselves) land in `runs/<id>/spans.jsonl`. Reuses the EXACT same
 * `makeRealBuilderDeps`/`makeRealCrewBuilderDeps` factories the CLI uses
 * (`src/cli/agent-builder.ts`/`crew-builder.ts`), only overriding
 * `confirm`/`log`/`verify.confirmReuse` with the SSE-bridged versions the
 * route built (Task 9/11) — everything else (model resolution, embedder,
 * judge wiring, fs paths) is identical to the CLI path.
 */
export function createRealRunBuilderTurn(runsRoot: string): RunBuilderTurn {
  return ({ kind, need, autoYes, force, runId, confirm, confirmReuse, log }) =>
    withRunTelemetry({ runsRoot, runId }, async () => {
      if (kind === BuilderKind.Agent) {
        const { deps, cleanup } = await makeRealBuilderDeps({ autoYes, force });
        try {
          const overridden: BuilderDeps = {
            ...deps,
            confirm,
            log,
            verify: deps.verify && { ...deps.verify, confirmReuse },
          };
          return toBuildResultDto(await buildAgent(need, overridden));
        } finally {
          await cleanup();
        }
      }
      const { deps, cleanup } = await makeRealCrewBuilderDeps({ autoYes, force });
      try {
        const overridden: CrewBuilderDeps = {
          ...deps,
          confirm,
          log,
          verify: deps.verify && { ...deps.verify, confirmReuse },
        };
        return toCrewBuildResultDto(await buildCrewOrWorkflow(need, overridden));
      } finally {
        await cleanup();
      }
    });
}
```

- [ ] **Step 8: Wire the three routes + `ServerDeps.runBuilderTurn` in `src/server/app.ts`**

Add imports: `import { handleBuilderAgentList, handleBuilderCrewList } from './builders/list.ts';`, `import { handleBuilderBuild } from './builders/build.ts';`, `import type { RunBuilderTurn } from './builders/build.ts';`. Add to `ServerDeps`:
```typescript
  /** Launches the agent/crew/workflow guided-build flow (Phase 5, Task 11/12). */
  runBuilderTurn: RunBuilderTurn;
```
Add three routes in `handleApi`, near the existing `/api/crews`/`/api/workflows` GETs (order doesn't matter against them — none of these three paths collide with any existing regex):
```typescript
        if (req.method === 'GET' && url.pathname === '/api/builders/agents') {
          rec.status(200);
          return handleBuilderAgentList();
        }
        if (req.method === 'GET' && url.pathname === '/api/builders/crews') {
          rec.status(200);
          return handleBuilderCrewList();
        }
        if (req.method === 'POST' && url.pathname === '/api/builders/build') {
          rec.status(200);
          return handleBuilderBuild(req, deps);
        }
```

- [ ] **Step 9: Wire the real turn in `src/server/main.ts`**

Add `import { createRealRunBuilderTurn, ... } from './launch-turns.ts';` (extend the existing import), `const runBuilderTurn = createRealRunBuilderTurn(runsRoot);` alongside the existing `runCrewTurn`/`runWorkflowTurn` lines, and add `runBuilderTurn` to the `deps` object literal.

- [ ] **Step 10: Fix the `ServerDeps`-literal fixture ripple**

Add `runBuilderTurn: async () => ({ kind: 'declined' })` (or a test-appropriate stub) to every existing `ServerDeps` object literal that now fails to typecheck:
- `tests/server/app.test.ts` — four literals (`deps`, `throwingDeps`, `confinedDeps`, `symlinkDeps`).
- `tests/server/runs-routes.test.ts` — one literal.
- `tests/server/phase4-routes.test.ts` — the shared `deps()` helper (also used by Task 11's own tests if they were dispatched against a shared fixture; here it's just the ripple fix).

- [ ] **Step 11: Run tests to verify they pass**

Run: `bun test tests/server/builders-list.test.ts tests/server/builders-turn.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts`
Expected: all PASS (`builders-turn.test.ts` may be `test.skip`-guarded per Step 5's note if no live model is reachable).

- [ ] **Step 12: SERVER-GROUP GATE — full suite**

Run: `bun run check` (docs:check · typecheck · lint · full `bun test`). This is the first full-suite checkpoint since `ServerDeps` gained a new required field — fix any further drift it surfaces.

- [ ] **Step 13: Gate + commit**

```bash
git add src/server/builders/list.ts src/server/launch-turns.ts src/server/app.ts src/server/main.ts tests/server/builders-list.test.ts tests/server/builders-turn.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts
git commit -m "feat(server): wire builder registry lists + POST /api/builders/build + createRealRunBuilderTurn (Phase 5)"
```

---

