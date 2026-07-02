# Task 1 Report: Minor ② — honest `mcp.mount` root-span counts (Slice 16)

## Status
**DONE**

## Commit
`d234c5c fix(telemetry): mcp.mount root span records mounted-server + summed tool counts (Slice 16 Task 1)`

## Test Summary
All 4 tests pass. The new test `withMcpMountSpan root-span counts > records mounted-server count and summed tool count (not a raw record count)` validates:
- `mcp.server.count` = 2 (only records with outcome === 'mounted')
- `mcp.tool.count` = 5 (sum of tool counts: 3 + 2 from the two mounted servers)
- 4 total `mcp.server.mount` events generated (one per call to record, regardless of outcome)

### Test Output (RED → GREEN)
**Before fix:**
```
error: expect(received).toBe(expected)
Expected: 2
Received: undefined
```

**After fix:**
```
bun test v1.3.11 (af24e281)

 4 pass
 0 fail
 7 expect() calls
Ran 4 tests across 1 file. [74.00ms]
```

## Changes Made

### 1. Added failing test (TDD)
File: `tests/mcp/tool-span.test.ts`
- Added imports for telemetry provider and file I/O (`initRunTelemetry`, `mkdtemp`, `readFile`, `rm`)
- Added new test suite `withMcpMountSpan root-span counts` with test that:
  - Creates a temporary run directory
  - Initializes telemetry
  - Records 4 servers (2 mounted, 1 consent not granted, 1 dormant)
  - Validates root span attributes and events
  - Cleans up

### 2. Added ATTR key
File: `src/telemetry/spans.ts` (line 63)
- Added `MCP_SERVER_COUNT: 'mcp.server.count'` to ATTR object

### 3. Fixed `withMcpMountSpan` function
File: `src/telemetry/spans.ts` (lines 407-435)
- Changed from tracking raw record count (`servers`) to tracking:
  - `mountedServers`: count of records with outcome === 'mounted'
  - `mountedTools`: sum of tool counts for records with outcome === 'mounted'
- Updated `record` function to only increment counters when outcome === 'mounted'
- Set both `MCP_SERVER_COUNT` and `MCP_TOOL_COUNT` attributes on root span

## Verification

### Typecheck
```
$ tsc --noEmit
(no errors)
```

### Lint
```
$ bun run lint:file -- "src/telemetry/spans.ts" "tests/mcp/tool-span.test.ts"
Checked 2 files in 7ms. No fixes applied.
```

### Test Results
```
bun test v1.3.11 (af24e281)

 4 pass
 0 fail
 7 expect() calls
Ran 4 tests across 1 file. [74.00ms]
```

### Pre-commit Hook
The docs-check hook passed during commit (no documentation updates needed for this telemetry-only fix).

## Concerns
None. The change is isolated to telemetry span attributes, maintains backward compatibility with the `withMcpMountSpan` function signature, and all existing tests continue to pass.
