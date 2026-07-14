### Task 1: Contracts foundation — string enums + isomorphic-purity guard

**Files:**
- Create: `src/contracts/enums.ts`
- Test: `tests/contracts/enums.test.ts`, `tests/contracts/isomorphic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: enums `RunOrigin`, `RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole`, `ModelLoadAction`, `StatusEventType` (all string enums). These are imported by Tasks 2–4.

- [ ] **Step 1: Write the failing enum test**

```ts
// tests/contracts/enums.test.ts
import { expect, test } from 'bun:test';
import {
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  StatusEventType,
} from '../../src/contracts/enums.ts';

test('RunOrigin carries the reserved provenance values', () => {
  expect(Object.values(RunOrigin)).toEqual([
    'manual',
    'schedule',
    'webhook',
    'api',
    'remote',
  ]);
});

test('RunLifecycle is not just terminal states', () => {
  expect(RunLifecycle.PausedAwaitingInput).toBe('paused-awaiting-input');
  expect(RunLifecycle.Resumable).toBe('resumable');
});

test('DegradeKind mirrors reliability ledger string values', () => {
  expect(Object.values(DegradeKind)).toEqual([
    'model_degraded',
    'agent_dropped',
    'tool_skipped',
    'retried',
    'circuit_open',
  ]);
});

test('StatusEventType discriminants are the data-part names', () => {
  expect(StatusEventType.Confirm).toBe('data-confirm');
  expect(StatusEventType.RunStart).toBe('data-run-start');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/enums.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/enums.ts`.

- [ ] **Step 3: Write the enums**

```ts
// src/contracts/enums.ts
/**
 * Every finite named value on the web wire. Isomorphic: this file imports
 * nothing (not even zod). Enums (not string-literal unions) per repo style;
 * discriminated unions elsewhere take their discriminant from `StatusEventType`.
 */

/** Run provenance (reserved; Slice 25 sets the non-`manual` values). */
export enum RunOrigin {
  Manual = 'manual',
  Schedule = 'schedule',
  Webhook = 'webhook',
  Api = 'api',
  Remote = 'remote',
}

/** Run lifecycle — not just terminal outcome (Slices 24/25/34/38 use the rest). */
export enum RunLifecycle {
  Queued = 'queued',
  Running = 'running',
  PausedAwaitingInput = 'paused-awaiting-input',
  Done = 'done',
  Failed = 'failed',
  Resumable = 'resumable',
}

export enum SpanStatus {
  Ok = 'ok',
  Error = 'error',
}

/** Run-artifact classification (mapper-side readdir+classify; Slice 30b Phase 3). */
export enum ArtifactKind {
  Answer = 'answer',
  Gap = 'gap',
  Spans = 'spans',
  Degradation = 'degradation',
  Other = 'other',
}

/**
 * Wire mirror of `src/reliability/ledger.ts` DegradeKind. The contract MUST NOT
 * import reliability (isomorphic rule), so we redeclare the identical string
 * values here; `tests/contracts/degrade-kind-parity.test.ts` guards they stay equal.
 */
export enum DegradeKind {
  ModelDegraded = 'model_degraded',
  AgentDropped = 'agent_dropped',
  ToolSkipped = 'tool_skipped',
  Retried = 'retried',
  CircuitOpen = 'circuit_open',
}

export enum ChatRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

/** Model-lifecycle transition carried by `data-model-load`. */
export enum ModelLoadAction {
  Pull = 'pull',
  Evict = 'evict',
  Warm = 'warm',
}

/** Transient SSE data-part discriminants (also the AI-SDK data-part type names). */
export enum StatusEventType {
  RunStart = 'data-run-start',
  Provision = 'data-provision',
  McpMount = 'data-mcp-mount',
  Delegation = 'data-delegation',
  ModelSelect = 'data-model-select',
  ModelLoad = 'data-model-load',
  Degrade = 'data-degrade',
  Confirm = 'data-confirm',
  RunEnd = 'data-run-end',
}
```

- [ ] **Step 4: Run enum test to verify it passes**

Run: `bun test tests/contracts/enums.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing isomorphic-purity guard test**

```ts
// tests/contracts/isomorphic.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const CONTRACTS_DIR = join(import.meta.dir, '../../src/contracts');

/** Extract every module specifier from `import ... from '...'` / `export ... from '...'`. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

test('src/contracts imports only zod or sibling ./ files', () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(join(CONTRACTS_DIR, file), 'utf8');
    for (const spec of importSpecifiers(src)) {
      const ok = spec === 'zod' || spec.startsWith('./');
      expect(ok, `${file} has forbidden import "${spec}"`).toBe(true);
    }
  }
});
```

- [ ] **Step 6: Run the guard test to verify it passes**

Run: `bun test tests/contracts/isomorphic.test.ts`
Expected: PASS — `enums.ts` has zero imports; the guard now protects every future contracts file.

- [ ] **Step 7: Commit**

```bash
git add src/contracts/enums.ts tests/contracts/enums.test.ts tests/contracts/isomorphic.test.ts
git commit -m "feat(contracts): add wire enums + isomorphic-purity guard test"
```

---

