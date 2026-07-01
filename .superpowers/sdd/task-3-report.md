# Task 3: `defineCrew` Static Validation — Report

## Status
✓ COMPLETE

## Implementation Summary

Implemented `defineCrew()` static validation and `effectiveTaskDeps()` helper per the brief specification.

### Files Changed
- **Created:** `src/crew/define.ts` (71 lines)
- **Created:** `tests/crew/define.test.ts` (69 lines)

## TDD Flow

### RED
```
bun test 'tests/crew/define.test.ts' 2>&1
# Result: Cannot find module '../../src/crew/define.ts'
```

### GREEN
```
bun test 'tests/crew/define.test.ts' 2>&1
# Result: 6 pass, 0 fail
```

### Verify Typecheck & Lint
```
bun run typecheck
# Result: clean

bun run lint:file -- "src/crew/define.ts"
# Result: clean (after formatting fixes)

bun test
# Result: 209 pass, 15 skip, 0 fail (full suite)
```

## Implementation Details

### `effectiveTaskDeps(task, index, tasks): string[]`
- Returns explicit `task.dependsOn` if present
- Else returns previous task ID if `index > 0`
- Else returns `[]` for first task
- Used by both validation and compile phases

### `defineCrew(def): CrewDef`
Validates in sequence:
1. **Unique member names** — Set-based dedup; throws `/duplicate member/i`
2. **Unique task IDs** — Set-based dedup; throws `/duplicate task/i`
3. **Member resolution** — Every `task.member` exists in crew; throws `/unknown member.*{name}/i`
4. **Dependency resolution** — Every effective dep ID exists in tasks; throws `/unknown.*{id}/i`
5. **Acyclic graph** — Kahn's topological sort over effective task deps; throws `/cycle/i`
   - Build in-degree map and reverse adjacency (dependents)
   - Process zero-in-degree nodes, decrement in-degrees of dependents
   - If fewer tasks were visited than total, a cycle exists

Returns unchanged `def` if all checks pass.

## Error Messages
All error messages match test regexes:
- `"duplicate member name: {name}"` → `/duplicate member/i`
- `"duplicate task id: {id}"` → `/duplicate task/i`
- `"task {id}: unknown member \"{name}\""` → `/unknown member.*{name}/i`
- `"task {id}: unknown dependsOn \"{id}\""` → `/unknown.*{id}/i`
- `"crew {id} has a task dependency cycle"` → `/cycle/i`

## Test Coverage
All 6 test cases pass:
1. ✓ Valid sequential crew accepted
2. ✓ Unknown member rejected
3. ✓ Unknown dependsOn target rejected
4. ✓ Duplicate member names and task IDs rejected
5. ✓ Dependency cycle rejected
6. ✓ `effectiveTaskDeps` defaults correctly

## Code Quality
- Early returns used throughout
- No `console.log` statements
- Full type safety (typecheck clean)
- Biome lint clean (formatting applied)
- All tests pass (209 pass, 0 fail, full suite)

## Key Decisions
- Used **Set** for O(1) dedup checks (names, IDs)
- Used **Kahn's algorithm** for acyclic validation (O(V+E) over task graph)
- **Effective deps** computed once per task during resolution check, reused for cycle detection to avoid duplication

## No Concerns
- All validation rules from brief implemented exactly
- Error messages match test regexes precisely
- Task 5 (compile.ts) can safely import and use `effectiveTaskDeps` for dependency resolution

---
**Commit:** `f20351f` — feat(crew): defineCrew static validation
