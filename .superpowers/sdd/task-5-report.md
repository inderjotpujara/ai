# Task 5 Report: Judge (MiniCheck check + faithfulness aggregation)

## Status
✅ **COMPLETE** — Implementation passing all tests, typecheck, and lint.

## Implementation
Created two core exports in `src/verification/judge.ts`:

1. **`checkClaim(claim, evidence, judgeModel, deps): Promise<boolean>`**
   - MiniCheck-style evaluator: formats a "Document / Claim / Is it supported?" prompt
   - Returns true if evidence is non-empty AND the LLM response starts with "yes" (case-insensitive)
   - Returns false if evidence is empty or response doesn't start with "yes"

2. **`verifyFaithfulness(claims, evidenceById, judgeModel, fallback, threshold, deps): Promise<Verdict>`**
   - Iterates over claims; for each:
     - No citedIds → mark unsupported with reason "no citation"
     - Has citedIds → gather evidence from the Map, call checkClaim
     - Collect result in ClaimVerdict with appropriate reason (undefined if supported, else "unsupported by cited evidence" or "cited chunk missing")
   - Aggregates: `faithfulness = supportedCount / totalClaims`
   - Sets `supported = faithfulness >= threshold`
   - Returns Verdict with claims, unsupportedClaims list, and usedFallback flag

## Test Coverage
Created `tests/verification/judge.test.ts` with 2 tests:

1. **checkClaim mapping**: Verifies "Yes"/No string → boolean conversion
   - "sky is blue" with evidence "the sky is blue" → true (contains "blue")
   - "grass is red" with evidence "grass is green" → false (doesn't contain "blue")

2. **verifyFaithfulness aggregation & thresholds**:
   - 3 claims: sky is blue (cited, passes check), grass is red (cited, fails check), uncited fact (no citation)
   - Threshold 0.9: 1/3 ≈ 0.333 < 0.9 → `supported = false`
   - Faithfulness = 1/3, unsupportedClaims = ["grass is red", "uncited fact"]
   - Uncited claim always marked unsupported regardless of threshold

Mock `VerifyDeps` checks for "blue" in the prompt to simulate judge model behavior.

## TDD Flow
1. ✅ **RED**: Test file created, import fails (judge.ts doesn't exist)
2. ✅ **GREEN**: Implementation written, 2/2 tests pass
3. ✅ **LINT**: Applied Biome formatter (long parameter lists, properly organized imports)
4. ✅ **TYPECHECK**: No errors
5. ✅ **COMMIT**: Committed with message "feat(verification): MiniCheck claim check + faithfulness aggregation"

## Code Quality
- **No `any` types**: Properly typed with `VerifyDeps` interface in tests
- **Formatted**: Biome checks pass (long function signatures split across lines, proper spacing)
- **Tested**: 2 comprehensive tests covering both functions + edge case (uncited claims)
- **Self-contained**: Imports only Claim/ClaimVerdict/Verdict/VerifyDeps from types.ts, no external dependencies

## Files
- `/Users/inderjotsingh/ai/src/verification/judge.ts` (57 lines)
- `/Users/inderjotsingh/ai/tests/verification/judge.test.ts` (47 lines)

## Verification
```bash
bun test tests/verification/judge.test.ts
# 2 pass, 0 fail, 8 expect() calls

bun run typecheck
# (no errors)

bun run lint:file -- src/verification/judge.ts tests/verification/judge.test.ts
# (no errors)

bun run test
# 267 pass (including new 2), 18 skip, 0 fail
```

## Commit
```
ad04cec feat(verification): MiniCheck claim check + faithfulness aggregation
```

## Concerns
None. Implementation follows the brief exactly, all tests pass, code is clean and properly typed.
