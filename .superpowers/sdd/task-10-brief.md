## Task 10: Result mapper — `toBuildResultDto`/`toCrewBuildResultDto`

**Files:**
- Create: `src/server/builders/map-result.ts`
- Test: `tests/server/builders-map-result.test.ts` (create)

**Interfaces:**
- Consumes: `BuildResult` (`src/agent-builder/types.ts:22-38`), `CrewBuildResult` (`src/crew-builder/types.ts:13-31`), `BuildResultDTO` (Task 3).
- Produces: `toBuildResultDto(result: BuildResult): BuildResultDTO`, `toCrewBuildResultDto(result: CrewBuildResult): BuildResultDTO`.

- [ ] **Step 1: Write the failing test**

`tests/server/builders-map-result.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { AgentProposal, BuildResult } from '../../src/agent-builder/types.ts';
import type { CrewBuildResult } from '../../src/crew-builder/types.ts';
import { toBuildResultDto, toCrewBuildResultDto } from '../../src/server/builders/map-result.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';

const proposal: AgentProposal = {
  name: 'stock_quotes',
  description: 'fetch quotes',
  systemPrompt: 'x',
  modelReq: { role: 'r', requires: [], prefer: 'largest-that-fits' as never },
  suggestedServers: [],
  rationale: 'why',
};

test('toBuildResultDto flattens every BuildResult variant, carrying the FULL proposal on `written`', () => {
  expect(
    toBuildResultDto({ kind: 'written', proposal, files: ['a.ts'], level: VerifiedLevel.Runs }),
  ).toEqual({
    kind: 'written',
    name: 'stock_quotes',
    files: ['a.ts'],
    level: VerifiedLevel.Runs,
    proposal,
  });
  expect(toBuildResultDto({ kind: 'declined' })).toEqual({ kind: 'declined' });
  expect(
    toBuildResultDto({ kind: 'invalid', issues: [{ field: 'name', problem: 'taken' }] }),
  ).toEqual({ kind: 'invalid', issues: [{ field: 'name', problem: 'taken' }] });
  expect(toBuildResultDto({ kind: 'abandoned', reason: 'timeout' })).toEqual({
    kind: 'abandoned',
    reason: 'timeout',
  });
  expect(toBuildResultDto({ kind: 'reused', name: 'existing', similarity: 0.9 })).toEqual({
    kind: 'reused',
    name: 'existing',
    similarity: 0.9,
  });
  expect(
    toBuildResultDto({ kind: 'failed-verification', stage: 'dry-run', detail: 'boom' }),
  ).toEqual({ kind: 'failed-verification', stage: 'dry-run', detail: 'boom' });
});

const crewResult: CrewBuildResult = {
  kind: 'written',
  shape: 'crew',
  name: 'research-crew',
  files: ['crews/research-crew.ts'],
  builtAgents: ['researcher'],
  level: VerifiedLevel.Behaves,
};

test('toCrewBuildResultDto flattens a written crew result (no IR carried — engine gap, see plan notes)', () => {
  expect(toCrewBuildResultDto(crewResult)).toEqual({
    kind: 'written',
    name: 'research-crew',
    files: ['crews/research-crew.ts'],
    level: VerifiedLevel.Behaves,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/builders-map-result.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/builders/map-result.ts`**

```typescript
import type { BuildResult } from '../../agent-builder/types.ts';
import type { BuildResultDTO } from '../../contracts/dto.ts';
import type { CrewBuildResult } from '../../crew-builder/types.ts';

/** Flattens `BuildResult` (`src/agent-builder/types.ts:22-38`) onto the wire
 *  shape (Task 3). `written`'s full `AgentProposal` is JSON-safe (D5) and
 *  structurally satisfies `AgentProposalDtoSchema` field-for-field, so it
 *  rides straight onto `BuildResultDTO.proposal` — this is what lets the
 *  wizard (Task 14) render the D6 post-write proposal DagView without a
 *  second round-trip. */
export function toBuildResultDto(result: BuildResult): BuildResultDTO {
  switch (result.kind) {
    case 'written':
      return {
        kind: 'written',
        name: result.proposal.name,
        files: result.files,
        level: result.level,
        proposal: result.proposal,
      };
    case 'declined':
      return { kind: 'declined' };
    case 'invalid':
      return { kind: 'invalid', issues: result.issues };
    case 'abandoned':
      return { kind: 'abandoned', reason: result.reason };
    case 'reused':
      return { kind: 'reused', name: result.name, similarity: result.similarity };
    case 'failed-verification':
      return {
        kind: 'failed-verification',
        stage: result.stage,
        detail: result.detail,
      };
  }
}

/** Flattens `CrewBuildResult` (`src/crew-builder/types.ts:13-31`) onto the
 *  same wire shape. Unlike the agent builder, `CrewBuildResult.written` does
 *  NOT carry the committed `CrewIR`/`WorkflowIR` back to the caller (only
 *  `name`/`files`/`builtAgents`) — an existing engine-side gap, not
 *  introduced here. This is why the crew/workflow wizard (Task 14) shows a
 *  plain result card, not a post-write DagView, for `written`: there is no IR
 *  to derive one from without a source change to `crew-builder/types.ts`. */
export function toCrewBuildResultDto(result: CrewBuildResult): BuildResultDTO {
  switch (result.kind) {
    case 'written':
      return {
        kind: 'written',
        name: result.name,
        files: result.files,
        level: result.level,
      };
    case 'declined':
      return { kind: 'declined' };
    case 'invalid':
      return { kind: 'invalid', issues: result.issues };
    case 'abandoned':
      return { kind: 'abandoned', reason: result.reason };
    case 'reused':
      return { kind: 'reused', name: result.name, similarity: result.similarity };
    case 'failed-verification':
      return {
        kind: 'failed-verification',
        stage: result.stage,
        detail: result.detail,
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/builders-map-result.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/builders/map-result.ts tests/server/builders-map-result.test.ts
git add src/server/builders/map-result.ts tests/server/builders-map-result.test.ts
git commit -m "feat(server): BuildResult/CrewBuildResult → BuildResultDTO mapper (Phase 5)"
```

---

