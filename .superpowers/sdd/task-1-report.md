# Slice 26, Task 1 Report: Add RuntimeKind.LlamaCpp + kind-map wiring

## What Changed

### Files Modified
1. **src/core/types.ts** — RuntimeKind enum
2. **src/core/kind-map.ts** — downloadKindFor function
3. **tests/core/kind-map.test.ts** — new test case

### Implementation Summary

#### src/core/types.ts
- Added new enum member: `LlamaCpp = 'LlamaCpp'` to RuntimeKind
- Updated comment for LmStudio from "reserved: LM Studio as an inference runtime (download-only in Slice 18)" to "LM Studio as an inference runtime"
- New LlamaCpp comment: "GGUF via a managed llama.cpp-server (-c dynamic context)"

#### src/core/kind-map.ts
- Added routing in downloadKindFor: `if (runtime === RuntimeKind.LlamaCpp) return ProviderKind.HfGguf;`
- Placed before the Ollama fallthrough logic as specified
- runtimeKindFor remains unchanged (as per brief — HfGguf still defaults to Ollama)

#### tests/core/kind-map.test.ts
- Added new test case: "llama.cpp GGUF downloads route to the HfGguf provider"
- Tests both 'gguf-file' and 'ollama' shape variants
- Verifies both paths return ProviderKind.HfGguf

## TDD Workflow Execution

### Step 1: Write Failing Test
Added test case to tests/core/kind-map.test.ts as specified in brief.

### Step 2: Run Test (Failure Verification)
```
bun test v1.3.11 (af24e281)

tests/core/kind-map.test.ts:
error: expect(received).toBe(expected)

Expected: "HfGguf"
Received: "Ollama"

(fail) downloadKindFor > llama.cpp GGUF downloads route to the HfGguf provider [0.68ms]

 4 pass
 1 fail
 6 expect() calls
Ran 5 tests across 1 file. [16.00ms]
```

### Step 3 & 4: Implement and Verify Green
Changes made to types.ts and kind-map.ts as specified.

Final test run:
```
bun test v1.3.11 (af24e281)

 5 pass
 0 fail
 6 expect() calls
Ran 5 tests across 1 file. [10.00ms]
```

## Quality Checks

### Typecheck
```
$ tsc --noEmit
(no errors)
```

### Lint
```
$ biome check src/core/types.ts src/core/kind-map.ts tests/core/kind-map.test.ts
Checked 3 files in 32ms. No fixes applied.
```

## Commit

**SHA:** `8a22986b6771fe1efcc1feb17a61d945d75d2466`

**Message:**
```
feat(runtime): add RuntimeKind.LlamaCpp + kind-map routing

Add LlamaCpp as a new inference runtime enum member and wire its download routing to HfGguf, enabling llama.cpp-server to retrieve GGUF models from HuggingFace repositories.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Files committed:**
- src/core/kind-map.ts (1 insertion)
- src/core/types.ts (3 insertions, 1 deletion)
- tests/core/kind-map.test.ts (8 insertions)

## Self-Review Notes

### Correctness
✓ Enum member added with correct string value matching the constant name (string enum style, per project rules)
✓ LlamaCpp routing returns ProviderKind.HfGguf as specified
✓ Both test cases (gguf-file and ollama shapes) now pass
✓ runtimeKindFor mapping unchanged as per brief note — HfGguf still defaults to Ollama (llama.cpp opts in via explicit declaration per Task 5)
✓ Comment clarification for LmStudio completed

### Code Quality
✓ Enum member placement — added after LmStudio, before closing brace
✓ Routing logic placement — added before Ollama fallthrough as specified
✓ No style violations; lint passes clean
✓ Typecheck clean; no type errors
✓ Test assertions clear and specific

### Task Compliance
✓ Used TDD: failing test → green implementation
✓ All three files modified as specified
✓ Inline test run confirmed locally
✓ Conventional commit format with co-authored-by line
✓ No existing enum members renamed or removed
✓ Brief requirements fully satisfied
