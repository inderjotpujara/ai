# Task 4 Report: Claim Decomposition + Citation Parsing (Slice 13)

## Summary
**Status:** ✅ COMPLETE

Implemented `src/verification/claims.ts` with two core functions:
1. `parseCitations(text: string): string[]` — extracts and dedupes `[mem:id]` citation references
2. `decomposeClaims(answer: string, deps: VerifyDeps): Promise<Claim[]>` — decomposes answers into atomic claims via model generation, with robust JSON parsing and fallback

## TDD Flow

### Step 1: Failing Test
Created `tests/verification/claims.test.ts` with two test cases:
- `parseCitations extracts + dedupes [mem:id]`
- `decomposeClaims parses model JSON`

Test failed as expected with "Cannot find module" error.

### Step 2: Implementation
Implemented `src/verification/claims.ts` per the brief specification:
- **`parseCitations`:** Uses regex `/\[mem:([^\]]+)\]/g` to find all citations, dedupes by checking `!out.includes(id)`
- **`extractJson`:** Strips markdown fence ` ```json` if present, extracts JSON array from raw model output
- **`decomposeClaims`:** 
  - Calls `deps.generate(deps.generalModel, prompt)` with carefully crafted prompt
  - Parses JSON array of `{text, citedIds}`
  - Falls back to single whole-answer claim if JSON parsing fails
  - Filters valid claims and normalizes `citedIds` to string arrays

### Step 3: Linting & Formatting
Initial lint run revealed 4 errors, 4 warnings:
- Fixed assignment-in-expression pattern by unrolling the while loop
- Replaced non-null assertions (`!`) with optional chaining (`?.`) + fallback (`?? raw.trim()`)
- Fixed `any` type by using `Record<string, unknown>` cast
- Applied Biome formatter suggestions for line breaks and function signature formatting

### Step 4: Verification

**Tests:** ✅ 2/2 pass (5 expect() calls)
```
bun test tests/verification/claims.test.ts
 2 pass
 0 fail
 5 expect() calls
Ran 2 tests across 1 file. [12.00ms]
```

**Typecheck:** ✅ Pass (no errors)

**Lint:** ✅ Pass (no errors/warnings)

## Files Modified/Created
- ✅ `src/verification/claims.ts` (35 lines)
- ✅ `tests/verification/claims.test.ts` (29 lines)

## Commit
```
dee74c1 feat(verification): claim decomposition + [mem:id] citation parsing
```

Passed pre-commit `docs-check` hook (living docs + subsystems documented).

## Implementation Details

### `parseCitations` Logic
- Regex pattern: `/\[mem:([^\]]+)\]/g` captures everything inside `[mem:...`]
- Loop through all matches, extract group 1 and trim whitespace
- Guard against duplicates with `!out.includes(id)` before pushing
- Returns empty array if no citations found

### `decomposeClaims` Logic
- Constructs a detailed prompt asking the model to break answer into atomic claims with citation ids
- `extractJson` helper handles both fenced and unfenced JSON output
- Try-catch wraps JSON.parse; catches any parsing errors
- Returns a **fallback claim** (the whole answer as one claim) if parsing fails — this keeps the primitive robust
- Filters out claims with missing/non-string `text` field
- Normalizes `citedIds` to string array (coerces via `.map(String)`, defaults to `[]`)

## Code Quality Notes
- ✅ No `any` types (cast to `Record<string, unknown>` when needed)
- ✅ No non-null assertions (replaced with optional chaining + nullish coalescing)
- ✅ No console.log or debug code
- ✅ Self-contained module (only imports types from `./types.ts`)
- ✅ Test mocks `generate` properly for isolation
- ✅ Formatter compliant (Biome checked)
- ✅ All linting rules satisfied

## Design Rationale

1. **Regex over string.split():** Citation format `[mem:id]` is unambiguous; regex handles deduplication elegantly
2. **Fallback to whole-answer claim:** Model may return unparseable JSON; rather than error, we degrade gracefully to treating the full answer as one claim with all its citations
3. **Type guards in filter:** Guard ensures only objects with string `text` field pass through, preventing runtime errors
4. **Prompt specificity:** Explicit instruction to cite ONLY `[mem:id]` tags in the answer keeps the model focused and outputs clean JSON

## Concerns
- None. Implementation is straightforward, well-tested, and follows the brief exactly.
