### Task 3: builder types (`types.ts`)

**Files:**
- Create: `src/crew-builder/types.ts`
- Test: none (type-only; covered by consumers).

**Interfaces:**
- Consumes: `BuilderModel` from `src/agent-builder/types.ts`, `CrewIR`/`WorkflowIR` from `ir.ts`, `ValidationIssue` from `src/agent-builder/types.ts`, `WritePaths` from `src/agent-builder/write.ts`, `BuilderDeps` from `src/agent-builder/types.ts`.
- Produces: `Shape`, `CrewBuildResult`, `CrewBuilderDeps`.

- [ ] **Step 1: Write the file** (type-only — no separate test; typecheck is the gate)

```ts
// src/crew-builder/types.ts
import type { BuilderDeps, BuilderModel, ValidationIssue } from '../agent-builder/types.ts';
import type { WritePaths } from '../agent-builder/write.ts';
import type { CrewIR, WorkflowIR } from './ir.ts';

export type Shape = 'crew' | 'workflow';

export type CrewBuildResult =
  | { kind: 'written'; shape: Shape; name: string; files: string[]; builtAgents: string[] }
  | { kind: 'declined' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'abandoned'; reason: string };

/** Where generated crews/workflows are written + how their registries are found. */
export type CrewWritePaths = {
  crewsDir: string; crewsIndexPath: string;
  workflowsDir: string; workflowsIndexPath: string;
};

export type CrewBuilderDeps = {
  model: BuilderModel;
  existingAgents: () => string[];       // agentNames()
  packNames: () => string[];            // STARTER_PACK names
  existingCrews: () => string[];        // Object.keys(CREWS)
  existingWorkflows: () => string[];    // Object.keys(WORKFLOWS)
  confirm: (proposalText: string) => Promise<boolean>;
  /** Auto-build a missing agent for a needed capability; returns built agent name or null on decline/failure. */
  buildMissingAgent: (need: string) => Promise<string | null>;
  paths: CrewWritePaths;
  agentPaths: WritePaths;               // passed through to buildMissingAgent's deps
  log?: (m: string) => void;
};

export type { BuilderDeps, ValidationIssue, CrewIR, WorkflowIR };
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` — clean.

- [ ] **Step 3: Commit**

```bash
git add src/crew-builder/types.ts
git commit -m "feat(crew-builder): result + deps types"
```

---

