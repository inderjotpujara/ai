### Task 12: registry markers in `crews/index.ts` + `workflows/index.ts`

**Files:**
- Modify: `crews/index.ts`, `workflows/index.ts` (add `// CREW-BUILDER:IMPORTS` / `// CREW-BUILDER:ENTRIES` markers)
- Test: `tests/crew-builder/markers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/crew-builder/markers.test.ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

for (const p of ['crews/index.ts', 'workflows/index.ts']) {
  test(`${p} has CREW-BUILDER markers`, () => {
    const src = readFileSync(p, 'utf8');
    expect(src).toContain('// CREW-BUILDER:IMPORTS');
    expect(src).toContain('// CREW-BUILDER:ENTRIES');
  });
}
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Edit both index files** — add the marker after the last import and before the closing `}` of the record. Example for `crews/index.ts`:

```ts
import type { CrewDef } from '../src/crew/types.ts';
import researchCrew from './research-crew.ts';
// CREW-BUILDER:IMPORTS (generated crew imports are inserted above this line — do not remove)

export const CREWS: Record<string, CrewDef> = {
  [researchCrew.id]: researchCrew,
  // CREW-BUILDER:ENTRIES (generated crew entries are inserted above this line — do not remove)
};

export function getCrew(name: string): CrewDef | undefined {
  return CREWS[name];
}
```

Do the analogous edit for `workflows/index.ts` (import `fetchThenSummarize`, entry `[fetchThenSummarize.id]: fetchThenSummarize`).

- [ ] **Step 4: Run — PASS** (`bun test tests/crew-builder/markers.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add crews/index.ts workflows/index.ts tests/crew-builder/markers.test.ts
git commit -m "feat(crew-builder): registry markers in crews/ + workflows/ index"
```

---

