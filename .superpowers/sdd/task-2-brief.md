### Task 2: Safe-helper vocabulary (`safe-helpers.ts`)

**Files:**
- Create: `src/crew-builder/safe-helpers.ts`
- Test: `tests/crew-builder/safe-helpers.test.ts`

**Interfaces:**
- Consumes: `WorkflowContext` from `src/workflow/types.ts`.
- Produces: `fromInput()`, `fromStep(ref)`, `fromTemplate(tpl)` → `(ctx)=>string`; `whenEquals(ref,value)`, `whenContains(ref,substr)`, `whenTruthy(ref)` → `(ctx)=>boolean`; `mapOver(ref)` → `(ctx)=>unknown[]`. These are imported by generated TS AND used by the transpiler's rendered calls.

- [ ] **Step 1: Write the failing test**

```ts
// tests/crew-builder/safe-helpers.test.ts
import { expect, test } from 'bun:test';
import { fromInput, fromStep, fromTemplate, mapOver, whenContains, whenEquals, whenTruthy } from '../../src/crew-builder/safe-helpers.ts';

test('fromInput returns the ctx.input as string', () => {
  expect(fromInput()({ input: 42 })).toBe('42');
});
test('fromStep stringifies a prior step output', () => {
  expect(fromStep('a')({ a: 'hello' })).toBe('hello');
  expect(fromStep('a')({ a: { x: 1 } })).toBe('{"x":1}');
});
test('fromTemplate interpolates {{ref}} placeholders', () => {
  expect(fromTemplate('sum: {{a}} / in: {{input}}')({ input: 'q', a: 'A' })).toBe('sum: A / in: q');
});
test('predicates read refs from ctx', () => {
  expect(whenEquals('a', 'yes')({ a: 'yes' })).toBe(true);
  expect(whenContains('a', 'err')({ a: 'an error' })).toBe(true);
  expect(whenTruthy('a')({ a: '' })).toBe(false);
});
test('mapOver returns an array (empty when not array)', () => {
  expect(mapOver('a')({ a: [1, 2] })).toEqual([1, 2]);
  expect(mapOver('a')({ a: 'x' })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew-builder/safe-helpers.test.ts` — FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/crew-builder/safe-helpers.ts
import type { WorkflowContext } from '../workflow/types.ts';

/** Stringify any ctx value deterministically (strings pass through). */
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v);
}

/** input closure: the workflow's initial input. */
export function fromInput(): (ctx: WorkflowContext) => string {
  return (ctx) => asStr(ctx.input);
}
/** input closure: a prior step's output by id. */
export function fromStep(ref: string): (ctx: WorkflowContext) => string {
  return (ctx) => asStr(ctx[ref]);
}
/** input closure: a template with {{ref}} placeholders resolved from ctx. */
export function fromTemplate(template: string): (ctx: WorkflowContext) => string {
  return (ctx) => template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => asStr(ctx[k]));
}
/** branch predicate: ref value === value. */
export function whenEquals(ref: string, value: string): (ctx: WorkflowContext) => boolean {
  return (ctx) => asStr(ctx[ref]) === value;
}
/** branch predicate: ref value contains substr. */
export function whenContains(ref: string, substr: string): (ctx: WorkflowContext) => boolean {
  return (ctx) => asStr(ctx[ref]).includes(substr);
}
/** branch predicate: ref value is truthy (non-empty string / truthy value). */
export function whenTruthy(ref: string): (ctx: WorkflowContext) => boolean {
  return (ctx) => Boolean(ctx[ref]) && asStr(ctx[ref]).length > 0;
}
/** map source: a prior step's output as an array (empty when not an array). */
export function mapOver(ref: string): (ctx: WorkflowContext) => unknown[] {
  return (ctx) => (Array.isArray(ctx[ref]) ? (ctx[ref] as unknown[]) : []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/crew-builder/safe-helpers.test.ts && bun run typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/crew-builder/safe-helpers.ts tests/crew-builder/safe-helpers.test.ts
git commit -m "feat(crew-builder): complete safe-helper closure vocabulary"
```

---

