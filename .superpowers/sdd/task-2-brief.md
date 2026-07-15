### Task 2: `RunListItemDTO` — the list-cheap summary DTO

**Files:**
- Modify: `src/contracts/dto.ts`
- Test: `tests/contracts/dto.test.ts` (extend)

**Interfaces:**
- Consumes: `RunLifecycle`, `RunOrigin` enums; the module-local `TokensSchema`.
- Produces: `RunListItemDtoSchema` + `RunListItemDTO` = `{ id: string, startMs: number, durationMs: number, outcome: string, lifecycle: RunLifecycle, origin: RunOrigin, models: string[], degraded: boolean, spanCount: number, tokens?: { input?, output? } }` — **no `spans`, no `artifacts`, no `degrades`** (the whole point of the summary cache). Auto-exported by the `export *` barrel.

- [ ] **Step 1: Write the failing test** — append to `tests/contracts/dto.test.ts`:

```ts
import { RunListItemDtoSchema } from '../../src/contracts/dto.ts';

test('RunListItemDTO parses a minimal summary (tokens optional, no spans/artifacts)', () => {
  const parsed = RunListItemDtoSchema.parse({
    id: 'run-1',
    startMs: 1000,
    durationMs: 42,
    outcome: 'answer',
    lifecycle: RunLifecycle.Done,
    origin: RunOrigin.Manual,
    models: ['qwen3.5:9b'],
    degraded: false,
    spanCount: 7,
  });
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.models).toEqual(['qwen3.5:9b']);
  // The list DTO deliberately carries no heavy arrays.
  expect('spans' in parsed).toBe(false);
  expect('artifacts' in parsed).toBe(false);
});

test('RunListItemDTO round-trips with a token roll-up present', () => {
  const parsed = RunListItemDtoSchema.parse({
    id: 'run-2',
    startMs: 0,
    durationMs: 0,
    outcome: 'unknown',
    lifecycle: RunLifecycle.Running,
    origin: RunOrigin.Manual,
    models: [],
    degraded: true,
    spanCount: 0,
    tokens: { input: 12, output: 8 },
  });
  expect(parsed.tokens).toEqual({ input: 12, output: 8 });
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/contracts/dto.test.ts` → FAIL (`RunListItemDtoSchema` not exported).

- [ ] **Step 3: Minimal impl** — append to `src/contracts/dto.ts` (after `RunDtoSchema`; `TokensSchema` is already declared at the top of the file):

```ts
/** Lightweight list summary — no `spans`/`artifacts`/`degrades` (that is the
 *  whole point of the mtime summary cache; Slice 30b Phase 3, Layer ②). */
export const RunListItemDtoSchema = z.object({
  id: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  lifecycle: z.enum(RunLifecycle),
  origin: z.enum(RunOrigin),
  models: z.array(z.string()),
  degraded: z.boolean(),
  spanCount: z.number(),
  tokens: TokensSchema,
});
export type RunListItemDTO = z.infer<typeof RunListItemDtoSchema>;
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/contracts/dto.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/contracts/dto.ts" "tests/contracts/dto.test.ts"
git add src/contracts/dto.ts tests/contracts/dto.test.ts
git commit -m "feat(contracts): RunListItemDTO — list-cheap run summary (no spans/artifacts)"
```

---

