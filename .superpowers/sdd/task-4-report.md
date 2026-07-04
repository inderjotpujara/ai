# Slice 19 · Task 4 Report — classify stage (`classify.ts`)

## Status: Implemented, all checks green.

## Commit
`fd67e32` — `feat(crew-builder): classify need as crew vs workflow`
Files: `src/crew-builder/classify.ts` (created), `tests/crew-builder/classify.test.ts` (created).

## TDD evidence

**RED** — `bun test tests/crew-builder/classify.test.ts`:
```
error: Cannot find module '../../src/crew-builder/classify.ts' from '/Users/inderjotsingh/ai/tests/crew-builder/classify.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN** — after implementing `src/crew-builder/classify.ts` per the brief:
```
bun test tests/crew-builder/classify.test.ts
3 pass
0 fail
3 expect() calls
Ran 3 tests across 1 file. [24.00ms]
```

**Typecheck** — `bun run typecheck` → `tsc --noEmit` clean, no output.

**Lint** — `bun run lint:file -- src/crew-builder/classify.ts tests/crew-builder/classify.test.ts`:
- First pass failed on Biome *formatting* only (line-wrap style: multi-line `z.string().describe(...)`, multi-line function signature, multi-line `expect(...)` chains) — no logic/lint-rule violations.
- Ran `bunx biome check --write` on both files to apply the canonical formatting.
- Re-ran lint: `Checked 2 files in 3ms. No fixes applied.` — clean.
- Re-ran test + typecheck after the format pass — still 3 pass / typecheck clean.

## Deviation from brief
The brief's code and test verbatim were correct in substance; the only change was **Biome auto-formatting** (line-wrapping long lines into biome's preferred multi-line form) applied via `bunx biome check --write`. No logic, signatures, or behavior changed — diff is whitespace/line-break only.

## Files
- `/Users/inderjotsingh/ai/src/crew-builder/classify.ts`
- `/Users/inderjotsingh/ai/tests/crew-builder/classify.test.ts`

## Self-review
- `classifyNeed` uses only the `BuilderModel.object` seam (no `generateObject` import) — confirmed via source read, no AI SDK import present.
- Injection guard present: raw `need` is wrapped via `delimitNeed(need)` before insertion into the prompt string; prompt also states the `<need>` block is data, not instructions.
- Default-to-`'crew'` behavior verified directly by the third test (`shape: 'nonsense'` → `'crew'`).
- `BuilderModel` at this point has only `.object` (no `.text`) per task context — the fake model in the test correctly implements only `.object`, matching the current `BuilderModel` type (`src/agent-builder/types.ts`); no `text` stub was added, and typecheck confirms this compiles.
- File is small, single-purpose, uses `type` imports appropriately, no `console.log`, early-return-friendly (single conditional expression, no nested branching).

## Concerns
None. Task is fully self-contained per the brief; no open questions.
