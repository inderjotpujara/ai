# Task 3: Contract Status Events — Transient-SSE Discriminated Union

## Status
**DONE**

## Commit
`bf1454e` — feat(contracts): add StatusEvent transient-SSE discriminated union

## Summary
- **Test**: `bun test tests/contracts/events.test.ts` — 5 pass, 0 fail
- **Typecheck**: `bun run typecheck` — clean, no errors
- **Isomorphic**: `bun test tests/contracts/isomorphic.test.ts` — 1 pass (confirms events.ts respects isomorphic rule)

## Implementation
Created `src/contracts/events.ts` (89 lines) with:
- 9 per-variant Zod schemas: `RunStartEventSchema`, `ProvisionEventSchema`, `McpMountEventSchema`, `DelegationEventSchema`, `ModelSelectEventSchema`, `ModelLoadEventSchema`, `DegradeEventSchema`, `ConfirmEventSchema`, `RunEndEventSchema`
- Discriminated union: `StatusEventSchema = z.discriminatedUnion('type', [...])`
- Exported type: `StatusEvent = z.infer<typeof StatusEventSchema>`

All schemas use enum members (StatusEventType, DegradeKind, ModelLoadAction) from `./enums.ts` as discriminants and field types. The `ConfirmEventSchema.kind` field remains a free string to accommodate extensibility across multiple consent seams.

## Test Results
**Before implementation** (Step 2): ✅ FAIL — module not found (expected)
**After implementation** (Step 4): ✅ PASS — 5/5 tests passing
**Type safety** (Step 5): ✅ Clean — zero type errors after adding strict-mode casts in test assertions
**Isomorphic check**: ✅ Pass — events.ts imports only `zod` and `./enums.ts`

## Type-Safety Notes
Test file required strict-mode casts per repo tsconfig (`noUncheckedIndexedAccess: true`):
- Line 17: `e.type as string` (Zod-inferred discriminant is union type, literal string is concrete)
- Lines 26, 36: Added `if (e.type === StatusEventType.X)` guards to narrow discriminated union for property access
- Line 48: Added `as const` to object literal fields to preserve literal types through JSON round-trip

These casts are type-safety enforcement only; no intent is weakened.

## Concerns
None. Task completed per spec, all gates green.

## FIX WAVE (non-vacuous assertions)

**Commit**: `9de669f` — test(contracts): make StatusEvent discriminant assertions non-vacuous

**Problem**: Two test assertions were wrapped in type-guard `if` blocks and passed vacuously (no assertion ran when the guard was false).

**Fix**: Added unconditional discriminant assertions before each type-guard block.

**data-model-load test (lines 20–29)**:
```ts
test('parses a data-model-load event with an enum action', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.ModelLoad,
    model: 'qwen3.5:4b',
    action: ModelLoadAction.Warm,
  });
  expect(e.type as string).toBe(StatusEventType.ModelLoad as string);  // NEW: unconditional discriminant
  if (e.type === StatusEventType.ModelLoad) {
    expect(e.action as string).toBe('warm');
  }
});
```

**data-confirm test (lines 31–41)**:
```ts
test('parses the bidirectional data-confirm ask', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Confirm,
    promptId: 'cap-abc123',
    kind: 'mcp-mount',
    question: 'Mount github MCP server?',
  });
  expect(e.type as string).toBe(StatusEventType.Confirm as string);  // NEW: unconditional discriminant
  if (e.type === StatusEventType.Confirm) {
    expect(e.promptId).toBe('cap-abc123');
  }
});
```

**Verification**:
- `bun run typecheck` — clean, no errors
- `bun test tests/contracts/events.test.ts` — 5 pass, 7 expect() calls (was 5 before; 2 new unconditional assertions now run)
