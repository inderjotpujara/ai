# Task 1 Report: mcp.json config loader

## Summary

Successfully implemented the MCP configuration loader with types, validation, and environment variable expansion. All 8 tests pass, typecheck and linting are clean.

## What Was Done

1. **Created `src/mcp/types.ts`** — Contains:
   - `enum McpTransportKind` for Stdio and Http transport kinds
   - `stdioEntrySchema` and `httpEntrySchema` zod validators
   - Type definitions for `StdioServerEntry`, `HttpServerEntry`, `McpServerEntry`, `McpConfig`, and `PackEntry`

2. **Created `src/mcp/config.ts`** — Contains:
   - `expandVars(value, env)` function to expand `${VAR}` and `${VAR:-default}` patterns in strings
   - `expandRecord()` helper to expand all values in a record
   - `defaultConfigPath()` to return the config path from env or default to `mcp.json` in cwd
   - `loadMcpConfig(path, env)` to load, validate, and parse `mcp.json` with graceful degradation

3. **Created `tests/mcp/config.test.ts`** — Comprehensive test suite with 8 tests covering:
   - Variable expansion with env vars
   - Default values in variable expansion
   - Reporting missing variables
   - Parsing stdio and http entries with agents
   - Marking entries with missing env vars as dormant (not failed)
   - Skipping malformed entries with warnings
   - Supporting VS-Code-style "servers" root with a warning
   - Graceful degradation on missing/corrupt files

## Test Results

```
bun test v1.3.11 (af24e281)

 8 pass
 0 fail
 15 expect() calls
Ran 8 tests across 1 file. [35.00ms]
```

## Deviations from the Brief

The code from the brief required formatting and linting adjustments to pass the project's biome linter:

1. **Template string escaping in tests**: Test descriptions and data strings containing `${VAR}` patterns that would be interpreted as template string placeholders were escaped using template literal syntax: `it(${'$'}{VAR})` to avoid the `noTemplateCurlyInString` linter warning. This is semantically equivalent to the brief's code but linter-compliant.

2. **Line formatting in config.ts**: Three long lines exceeding the line length limit were broken across multiple lines:
   - Error message in the JSON parse catch block
   - VS-Code-style servers warning message
   - Schema validation error message

These formatting changes are cosmetic and do not alter functionality.

## Verification Checklist

- ✅ Tests pass (8/8)
- ✅ Typecheck passes (`bun run typecheck`)
- ✅ Linter passes (`bun run lint:file`)
- ✅ No console.log statements in src/
- ✅ Code follows project conventions (type over interface, early returns, small focused files)
- ✅ Zod v4 used as specified (no new dependencies)
- ✅ Committed with exact message from brief

## Commit

```
SHA: 8351751
Message: feat(mcp): mcp.json types + validated loader with env expansion and per-entry degrade (Slice 15 Task 1)
```

---

# Task 1 Review — MCP Config Validation Fix Report

## Summary of Changes

Fixed two critical issues found in Task 1 code review (Slice 15, Task 1 review feedback):

### Issue 1: Branch-Targeted Schema Validation
**File:** `src/mcp/config.ts`

**Problem:** Plain zod union on `serverEntrySchema` reported only generic "Invalid input" error, hiding the actual validation failure reason (e.g., missing `command` field).

**Solution:**
- Detect HTTP-like entries (`url` or `type` field present) vs. stdio entries
- Route to the appropriate schema (`httpEntrySchema` or `stdioEntrySchema`)
- Extract field path and detailed error message from zod
- Warning now reads: `mcp.json entry "bad" is invalid and was skipped: at "command" Invalid input: expected string, received undefined`

**Changes:**
- Import `httpEntrySchema` and `stdioEntrySchema` explicitly (now exported in types.ts)
- Added `isHttpLike()` branch detector
- Updated entry validation loop to use branch-targeted parse
- Adjusted `toEntry()` parameter type to union of explicit schemas
- Kept `serverEntrySchema` exported in types.ts (backwards compatibility)

### Issue 2: Regression Tests for `entry.raw` Security Property
**File:** `tests/mcp/config.test.ts`

**Problem:** No test coverage for the critical security property that `entry.raw` preserves the as-written (unexpanded) config value for consent hashing.

**Solution:** Added two regression tests:
1. **"keeps raw unexpanded while expanding the live fields"** — verifies that `raw` contains `${TOKEN}` while live fields expand to `secret-value`
2. **"malformed-entry warning names the actual problem"** — verifies that warnings identify the specific invalid field (not generic "Invalid input")

## Test Results

```
bun test tests/mcp/config.test.ts
 10 pass
 0 fail
 22 expect() calls
Ran 10 tests across 1 file. [34.00ms]
```

All tests pass, including the two new regression tests (8 original + 2 new = 10 total).

## Lint & Type Check

```
bun run typecheck     — ✓ pass (no errors)
bun run lint:file    — ✓ pass (no errors)
```

## Files Modified

- `src/mcp/config.ts` — branch-targeted validation + imports
- `src/mcp/types.ts` — exports already present, no changes needed
- `tests/mcp/config.test.ts` — added 2 regression tests

## Fix Commit

```
Message: fix(mcp): branch-targeted config validation errors + raw-unexpanded regression test (Slice 15 Task 1 review)
```
