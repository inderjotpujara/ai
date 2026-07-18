## Task 20 report: MCP mapper + addressable mount-status snapshot

**Commit:** `05921c4a` — `feat(mcp): McpServerDTO mapper + addressable mount-status snapshot (Phase 5)`

### What was implemented

- `src/mcp/mcp-dto.ts` (new): pure mapper module.
  - `McpMountStatusEntry = { status: 'mounted' | 'skipped'; reason?: string }` — what the mount-status snapshot records per server name.
  - `mapMcpEntryToDto(entry: McpServerEntry, mounted: McpMountStatusEntry | undefined): McpServerDTO` — projects one validated engine `McpServerEntry` (`src/mcp/types.ts`) joined with its optional mount-status record into the wire `McpServerDTO`. Never-attempted entries default to `status: Skipped` with the hint `'not mounted this session — use Test Mount'`. `authKind` is `OAuth` only for an `Http` entry with `auth.kind === McpAuthKind.OAuth`; everything else is `Static`. `agents` is carried through only when present (optional field).
  - `mapMcpDormantToDto(d: McpConfig['dormant'][number]): McpServerDTO` — projects a dormant config entry (Task 19's retained `kind`) to a `status: Dormant` DTO row with reason `'set <VARS> to activate'`, always `authKind: Static` (a dormant entry's raw `auth` field isn't retained by `McpConfig.dormant`).
  - Pure, no I/O — matches the run-dto / crew-dto / workflow-dto mapper idiom (engine enum used for narrowing internally, contract enum used for the DTO's output fields, kept as two separate imports since contracts stay isomorphic).
- `src/server/mcp/mount-status.ts` (new): `createMcpMountStatus(): McpMountStatus` — an addressable, in-memory `Map<string, McpMountStatusEntry>` keyed by server name, with `.record(name, status, reason?)` and `.get(name)`. Exactly the brief's Step 7 code.
- `tests/mcp/mcp-dto.test.ts` (new): 4 tests — never-mounted stdio → skipped+hint; recorded-mounted http+OAuth; agents-scope carry-through; dormant → reason with retained `kind`. Both transport kinds (stdio + http) are covered, closing the gap T19 left (T19's tests only covered http).
- `tests/server/mcp-mount-status.test.ts` (new): 1 test — record/get round-trip, unrecorded name is `undefined`, second `.record` overwrites with a reason.

### Status-enum decision: introduced (as `McpServerStatus`, not `McpMountStatus`)

The T5 review flagged `McpServerDTO.status` as a raw `z.enum(['mounted','skipped','dormant'])` instead of a named enum. I introduced a proper enum:

```ts
// src/contracts/enums.ts
export enum McpServerStatus {
  Mounted = 'mounted',
  Skipped = 'skipped',
  Dormant = 'dormant',
}
```

and wired `src/contracts/dto.ts`'s `McpServerDtoSchema.status` to `z.enum(McpServerStatus)`. No parity test — this is contract-owned (no engine mirror), same pattern as `RunKind`/`BuilderKind`.

**Naming deviation from the task note:** the note suggested naming it `McpMountStatus`, but the brief's own Step 7 code already declares `export type McpMountStatus = { record(...), get(...) }` in `src/server/mcp/mount-status.ts` (the addressable snapshot-store's factory return type). Reusing the same name for the DTO enum would create two unrelated concepts sharing one identifier across the module (no TS compile error since they're never imported into the same file, but a real readability/grep hazard). I named the enum `McpServerStatus` instead — describes exactly what it is (the status of one server row on the DTO) — and documented the rationale in the enum's doc comment.

**Deliberately kept as a literal:** `McpMountStatusEntry.status` (`'mounted' | 'skipped'`, in `src/mcp/mcp-dto.ts`) stays a plain literal union, not the enum. It's the narrower, un-addressable per-attempt outcome type that `.record()` takes bare string arguments for (per the brief's exact `mount-status.test.ts` calls, e.g. `status.record('gh', 'mounted')`), and it doesn't need a `dormant` value (a dormant entry never attempts a mount). Widening it to reuse `McpServerStatus` would have forced call sites to import and reference enum members instead of bare strings, which is out of scope of the review note (that flagged only `McpServerDTO.status`) and would have been unnecessary churn.

### TDD evidence

RED (before implementation):
```
error: Cannot find module '../../src/server/mcp/mount-status.ts' from '/Users/inderjotsingh/ai/tests/server/mcp-mount-status.test.ts'
error: Cannot find module '../../src/mcp/mcp-dto.ts' from '/Users/inderjotsingh/ai/tests/mcp/mcp-dto.test.ts'
0 pass / 2 fail / 2 errors
```

GREEN (after implementation):
```
bun test tests/mcp/mcp-dto.test.ts tests/server/mcp-mount-status.test.ts
5 pass / 0 fail / 7 expect() calls
```

### A typecheck-driven test adjustment (not a behavior change)

Implementing the mapper exactly per the brief's Step 3 code, and the tests exactly per Step 1, revealed two `bun run typecheck` failures that are unrelated to runtime behavior:

1. In `tests/mcp/mcp-dto.test.ts`, `const entry = { kind: EngineKind.Stdio, ... }` (no annotation) widens the `kind` property's inferred type from the specific enum-member literal (`McpTransportKind.Stdio`) to the general `McpTransportKind` enum type — a documented TS quirk (object-literal property widening applies to enum members too, confirmed via an isolated repro). That broke assignability to the `McpServerEntry` discriminated union. Fix: annotate each `entry` const with its specific engine type (`StdioServerEntry` / `HttpServerEntry`), which supplies the contextual type and prevents the widening — zero behavior change, only added type annotations + two new type-only imports from `src/mcp/types.ts`.
2. Once `McpServerDTO.status` became enum-typed, the `toEqual({ status: 'skipped' })`-style raw string literals in both `tests/mcp/mcp-dto.test.ts` and the pre-existing `tests/contracts/library-dto.test.ts` no longer type-checked against the enum. Fixed by referencing `McpServerStatus.Skipped/.Mounted/.Dormant` instead — matching the repo's existing convention of asserting against the enum member (e.g. `tests/run/error-lifecycle.test.ts` uses `RunLifecycle.Failed`, never raw strings). Runtime values are identical (`McpServerStatus.Mounted === 'mounted'`).

Neither fix touches the mapper's actual logic or any test's asserted values — both are required precisely because the strict per-task gate runs `bun run typecheck`, which `bun test` alone does not exercise.

### Gate results

- `bun run typecheck` — clean, 0 errors.
- `bun run lint:file -- src/mcp/mcp-dto.ts src/server/mcp/mount-status.ts src/contracts/enums.ts src/contracts/dto.ts tests/mcp/mcp-dto.test.ts tests/server/mcp-mount-status.test.ts tests/contracts/library-dto.test.ts` — 0 errors after `biome check --write` auto-formatted 4 files (pure formatting, no logic changes — reviewed the diffs, all just line-wrapping).
- Focused tests: 5/5 pass (`tests/mcp/mcp-dto.test.ts` + `tests/server/mcp-mount-status.test.ts`).
- Full regression sweep: `bun test tests/mcp/ tests/server/` — 227 pass / 0 fail (48 files). `bun test tests/contracts/` — 79 pass / 0 fail.

### Files changed

- `src/contracts/enums.ts` — added `McpServerStatus` enum.
- `src/contracts/dto.ts` — `McpServerDtoSchema.status` now `z.enum(McpServerStatus)` instead of the raw string-literal enum.
- `src/mcp/mcp-dto.ts` (new) — `McpMountStatusEntry`, `mapMcpEntryToDto`, `mapMcpDormantToDto`.
- `src/server/mcp/mount-status.ts` (new) — `McpMountStatus` type, `createMcpMountStatus()`.
- `tests/mcp/mcp-dto.test.ts` (new) — 4 mapper tests (both transport kinds, OAuth, dormant, agents-scope).
- `tests/server/mcp-mount-status.test.ts` (new) — 1 snapshot round-trip test.
- `tests/contracts/library-dto.test.ts` (pre-existing, minimally touched) — updated its one `status: 'mounted'` literal to `McpServerStatus.Mounted` to keep typecheck clean after the enum introduction.

### Self-review

- Mapper is pure (no I/O, no side effects) — matches run-dto/crew-dto/workflow-dto style.
- Engine-vs-contract enum boundary is respected: `entry.kind === McpTransportKind.Http` (engine enum, narrows `entry` to `HttpServerEntry` so `.auth` is reachable) vs. the DTO's output `kind`/`authKind`/`status` fields (contract enums). Contracts import nothing from `src/mcp` (isomorphic rule intact — verified via the import list in `dto.ts`/`enums.ts`, no new cross-import introduced).
- `docs:check` (pre-commit hook) passed clean — this task only touches `src/contracts` and `src/mcp`/`src/server/mcp`, both already-documented subsystems in `docs/architecture.md`; no new subsystem introduced, so no `architecture.md` edit was required for this specific task (Task 21's route handler and later Phase-5 doc pass are where the MCP tab's wiring gets documented end-to-end).
- No parity test was added for `McpServerStatus`, correctly — it's contract-owned with no engine mirror, matching the existing `RunKind`/`BuilderKind` precedent the codebase already established.

### Concerns

- None blocking. One minor naming note already covered above (chose `McpServerStatus` over the note's suggested `McpMountStatus` to avoid a collision with the brief's own `src/server/mcp/mount-status.ts` factory-return type name) — flagging here again for visibility in case a later task/reviewer expected the exact name `McpMountStatus` for the DTO enum.
- `tests/contracts/library-dto.test.ts` needed a 1-line update outside the brief's stated file list — purely to keep `bun run typecheck` clean after the enum change; no assertion semantics changed.
