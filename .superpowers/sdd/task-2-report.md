# Task 2 Report: Contract DTOs + Parity Guard

## Status: DONE

**Commit:** `8d07200` on branch `slice-30b-local-web-ui`

**Test Summary:** `tests/contracts/dto.test.ts` (4 tests PASS) + `tests/contracts/degrade-kind-parity.test.ts` (1 test PASS) + isomorphic guard (1 test PASS); full suite 10 tests across 4 files, all PASS.

## What shipped

- **`src/contracts/dto.ts`** (103 lines) — Zod schemas for wire DTOs:
  - `DegradeDtoSchema`/`DegradeDTO`: degradation event (kind/label/subject/reason + forward-compat optionals: from/to/attempts/lane/spanId)
  - `SpanDtoSchema`/`SpanDTO`: trace span (spanId/parentSpanId/name/timing/status/degraded/attributes/events + forward-compat: statusMessage/agent/delegation/model/node/tokens)
  - `RunDtoSchema`/`RunDTO`: run metadata (id/owner/origin/lifecycle/timing/outcome/models/degraded + nested spans/artifacts/degrades array + forward-compat: contentPolicy/tokens)
  - `ChatMessageDtoSchema`/`ChatMessageDTO`: chat message (id/role/text + forward-compat: degraded, reserved for Slice 37)
  - Shared `TokensSchema` (optional token roll-up; mapper tolerates absence per telemetry gap #1)

- **`tests/contracts/dto.test.ts`** (59 lines) — 4 TDD tests:
  - Minimal span parsing (forward-compat optionals absent parse cleanly)
  - JSON serialize/parse round-trip with all optionals present
  - RunDTO with enum validation (origin/lifecycle/artifact-kind)
  - RunDTO enum rejection (unknown lifecycle value throws)

- **`tests/contracts/degrade-kind-parity.test.ts`** (10 lines) — 1 parity test:
  - Ensures contract `DegradeKind` enum values stay isomorphic with `src/reliability/ledger.ts`'s `DegradeKind`
  - Allowed to import both (test exemption) without contract importing reliability

## Verification

- **Isomorphic rule:** dto.ts imports only `zod` + `./enums.ts` (verified by `isomorphic.test.ts`)
- **Enum parity:** Contract DegradeKind matches ledger DegradeKind (5 values: ModelDegraded/AgentDropped/ToolSkipped/Retried/CircuitOpen)
- **Pre-commit hook:** `docs-check` passed — living docs + subsystem docs intact
- **All 10 tests pass:**
  - `bun test tests/contracts/dto.test.ts` → 4 PASS
  - `bun test tests/contracts/degrade-kind-parity.test.ts` → 1 PASS
  - `bun test tests/contracts/isomorphic.test.ts` → 1 PASS
  - `bun test tests/contracts/` → 10 PASS across 4 files (includes Task 1 enums test)

## Implementation details

- Used `z.enum(NativeEnum)` for TypeScript enums (verified with Zod v4)
- Used `z.record(z.string(), z.unknown())` for untyped attribute bags (verified works)
- Forward-compat optionals properly marked `.optional()` (schema parses cleanly when absent)
- JSON round-trip tested (serialize/parse/expect equal)
- No forbidden imports, no console.log, TS strict clean

## Concerns

None. Brief was self-consistent; implementation is a direct transcription of the provided code.

## FIX WAVE (typecheck)

**Commit:** `ed98761` on branch `slice-30b-local-web-ui`

Resolved strict typecheck failures in contract test files under `noUncheckedIndexedAccess` + enum literal comparison rules:

- `tests/contracts/enums.test.ts:10` — cast `Object.values(RunOrigin)` to `string[]`
- `tests/contracts/enums.test.ts:25` — cast `Object.values(DegradeKind)` to `string[]`
- `tests/contracts/enums.test.ts:20,21,35,36` — cast enum members to `string` before `.toBe()` assertions
- `tests/contracts/dto.test.ts:70` — use optional chaining `degrades[0]?.kind` for indexed access
- `tests/contracts/isomorphic.test.ts:13` — guard regex match group with `if (m[1] !== undefined)` before push

**Verification:**
```
$ bun run typecheck
(no output = clean, zero errors across entire repo)

$ bun test tests/contracts/
bun test v1.3.11 (af24e281)
 10 pass
 0 fail
 17 expect() calls
Ran 10 tests across 4 files. [55.00ms]
```
