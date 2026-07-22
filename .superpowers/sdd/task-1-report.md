# Task 1 Report: A2A wire contracts + parity test (Slice 31)

(Note: this file previously held a report for an unrelated Slice 25 task
that reused this filename. Overwritten with the Slice 31 Task 1 report
below.)

## Status: DONE

## Commit
- `237e759` — `feat(contracts): A2A v1.0 wire contracts (card/message/task/part + JSON-RPC + TaskStateWire)`

## Ambiguity resolution applied
Per the controller's explicit instruction, ignored Step 3's stale "(Import only zod + JobKindWire ...)" parenthetical. `src/contracts/a2a.ts` imports **only `zod`** — no `JobKindWire` import, since no Task-1 schema uses it (importing it unused would trip biome `noUnusedImports` and fail the `lint:file` gate).

## Files changed
- **Created** `src/contracts/a2a.ts` — `TaskStateWire` enum (8 states), `A2aMethod` enum (5 JSON-RPC methods), `PartSchema` (discriminated union on `kind`: text/file/data), `MessageSchema`/`A2aMessage`, `ArtifactSchema`/`A2aArtifact`, `TaskStatusSchema`/`A2aTaskStatus`, `TaskSchema`/`A2aTask`, `AgentSkillSchema`/`A2aAgentSkill`, `AgentCardSchema`/`A2aAgentCard`, `JsonRpcRequestSchema`/`JsonRpcRequest`, `JsonRpcErrorSchema`/`JsonRpcError`, `JsonRpcResponseSchema`/`JsonRpcResponse`. Every schema gets a paired `z.infer` type export, matching the `dto.ts` house convention (the brief only names paired types for Message/Artifact/Task/AgentCard explicitly; extended the same pattern to Part/AgentSkill/TaskStatus/JsonRpc* for consistency — later A2A tasks will need these types).
- **Modified** `src/contracts/index.ts` — added `export * from './a2a.ts';`.
- **Created** `tests/contracts/a2a-contracts.test.ts` — the brief's exact 3 tests, with one adaptation: `Object.values(TaskStateWire).sort()` needed an `as string[]` cast before `.toEqual([...string literals])` to satisfy `tsc --noEmit` (TS won't `toEqual` a `TaskStateWire[]` against bare string literals). This is not an invented deviation — it's the identical cast pattern already used throughout `tests/contracts/enums.test.ts` (e.g. `Object.values(RunOrigin) as string[]`), so it matches existing house convention.

## TDD evidence

### RED (Step 2)
```
$ bun run test -- -t "TaskStateWire holds"
error: Cannot find module '../../src/contracts/a2a.ts' from '/Users/inderjotsingh/ai/tests/contracts/a2a-contracts.test.ts'
0 pass / 31 skip / 1 fail / 1 error
```

### GREEN (Step 4, after implementation)
```
$ bun run test -- -t "TaskStateWire holds|PartSchema round-trips|AgentCardSchema rejects"
3 pass
31 skip
0 fail
5 expect() calls
```

### Gate (Step 5)
```
$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- src/contracts/a2a.ts src/contracts/index.ts tests/contracts/a2a-contracts.test.ts
$ biome check "src/contracts/a2a.ts" src/contracts/index.ts "tests/contracts/a2a-contracts.test.ts"
Checked 3 files in 25ms. No fixes applied.
```
One round of `bunx biome check --write` was needed first, to auto-format the test file's multi-line object/array literals and a wrapped `.toMatchObject` call, plus wrapping one object literal in `a2a.ts` — both purely formatting, no semantic change. Re-ran the gate clean after.

### Regression check (extra, beyond the brief's required gate, run for safety)
```
$ bun test tests/contracts/
135 pass
0 fail
212 expect() calls
Ran 135 tests across 36 files.
```
Includes `tests/contracts/isomorphic.test.ts`, confirming `src/contracts/a2a.ts` imports only `zod` (no engine/Node imports) — the isomorphic rule holds.

## Self-review vs the Produces block
- `TaskStateWire`: all 8 members, exact lowercase-hyphenated values — verified by the sorted-values test.
- `A2aMethod`: all 5 members, exact JSON-RPC method-name strings — checked visually against the brief. No dedicated assertion exists for it in Task 1's test file, matching the brief (Step 1 only specifies TaskStateWire/PartSchema/AgentCardSchema tests); it will presumably be exercised by later A2A tasks (server/client) that dispatch on method names.
- `PartSchema`: implemented as `z.discriminatedUnion('kind', [...])` (zod v4's idiomatic form for a `kind`-discriminated union) rather than a plain `z.union` — functionally matches the brief's `|`-separated shape description and is verified by the round-trip + reject-unknown-kind test.
- `MessageSchema`/`ArtifactSchema`/`TaskStatusSchema`/`TaskSchema`/`AgentSkillSchema`/`AgentCardSchema`: field-by-field cross-checked against the brief; all optional/default/literal annotations match exactly (e.g. `artifacts`/`history` `.default([])` on `TaskSchema`, `preferredTransport.default('JSONRPC')` and `security.default([])` on `AgentCardSchema`, `protocolVersion: z.literal('1.0')`).
- JSON-RPC envelopes (`JsonRpcRequestSchema`/`JsonRpcErrorSchema`/`JsonRpcResponseSchema`): field-by-field match, including `id: z.union([z.string(), z.number()]).nullable()`.
- YAGNI: built only the schemas/enums named in the Produces block — no extra helpers, parsers, or validation logic beyond what's specified. The one addition beyond literal transcription is the paired `z.infer` type export per schema, which is house convention (`dto.ts`), not new surface area.
- Test hygiene: no `.only`/`.skip`, no leftover `console.log`, test file matches the brief's given code (plus the one typecheck-driven cast noted above).

## Concerns
None outstanding. The single adaptation (the `as string[]` cast) is a pre-existing, well-established convention already present in this repo's `enums.test.ts`, not something newly introduced.
