# Task 4 Implementation Report: Contract inbound request schemas + barrel

## Status
**DONE**

## Commit
`a89752d feat(contracts): add inbound request schemas + barrel export`

## Implementation

### Files Created
1. **`src/contracts/requests.ts`** (31 lines)
   - `UiMessagePartSchema`: minimal structural shape `{ type, text? }`
   - `UiMessageLikeSchema`: `{ id, role, parts[] }`; imports only `zod` + `ChatRole` from `./enums.ts`
   - `UiMessageLike` type alias via `z.infer`
   - `ChatRequestSchema`: `{ messages: UiMessageLike[], sessionId?: string }`
   - `ChatRequest` type alias
   - `RespondRequestSchema`: `{ promptId: string, value: unknown }`
   - `RespondRequest` type alias
   - No AI-SDK imports (forward-compat for Slice 23)

2. **`src/contracts/index.ts`** (4 lines)
   - Barrel re-export: `./enums.ts`, `./dto.ts`, `./events.ts`, `./requests.ts`
   - Flat imports only (isomorphic rule enforced by test)

3. **`tests/contracts/requests.test.ts`** (33 lines)
   - 4 test cases (matches brief exactly):
     - UiMessageLike validates minimal body
     - ChatRequest validates messages + optional sessionId
     - ChatRequest rejects malformed body (missing messages)
     - RespondRequest requires promptId, accepts opaque value

## Test Results

### Command: `bun test tests/contracts/requests.test.ts`
```
 4 pass
 0 fail
 6 expect() calls
Ran 4 tests across 1 file. [23.00ms]
```

### Command: `bun test tests/contracts/isomorphic.test.ts`
```
 1 pass
 0 fail
 11 expect() calls
Ran 1 test across 1 file. [15.00ms]
```
✔ Confirms `src/contracts/` remains flat (imports only `zod` + `./` siblings).

### Command: `bun test tests/contracts/`
```
 19 pass
 0 fail
 38 expect() calls
Ran 19 tests across 6 files. [60.00ms]
```
✔ All contract tests (enums, dto, events, requests, isomorphic, degrade-kind-parity) pass.

### Command: `bun run typecheck`
```
$ tsc --noEmit
```
✔ Clean (no output, exit 0).

## Self-Review Checklist

- [x] **Schema correctness:** All four inbound schemas (UiMessagePart, UiMessageLike, ChatRequest, RespondRequest) match brief exactly.
- [x] **Type aliases:** Each schema has a corresponding `z.infer<typeof ...>` type alias (UiMessageLike, ChatRequest, RespondRequest).
- [x] **Isomorphic rule:** `requests.ts` + `index.ts` import only `zod` + `./enums.ts` (no AI-SDK, no external deps).
- [x] **Test coverage:** 4 tests cover happy path (minimal UIMessage, ChatRequest, RespondRequest), rejection (missing messages, missing promptId), and edge cases (optional sessionId, opaque value).
- [x] **Guard patterns:** Tests use optional chaining on array access (`parsed.parts[0]?.text`) per strict tsconfig.
- [x] **Barrel export:** `index.ts` re-exports all 4 modules in correct order.
- [x] **Typecheck:** Strict TypeScript (noUncheckedIndexedAccess, etc.) passes clean.
- [x] **Pre-commit hooks:** docs-check passed (no doc changes required for Phase-1 contracts).
- [x] **Commit message:** Follows repo conventions (`feat(contracts): ...`).

## Concerns
None. All gates pass, implementation exact to brief, no deviations.

## Next Steps
Task 4 Phase-1 complete. Contract surface is now sealed (enums, dto, events, requests, index). Ready for Phase-2 wire handlers + the chat endpoint handler to consume these schemas.
