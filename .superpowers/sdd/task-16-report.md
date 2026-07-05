# Task 16 report: MCP tool-call breaker wrap

## Status
DONE

## What changed
- `src/mcp/client.ts`
  - Added exported `wrapToolsWithBreaker(serverName, tools, opts?)`: wraps every
    tool's `execute` (when present) so calls run inside
    `breakerFor('mcp:' + serverName, opts).run(...)`. Tools without an
    `execute` pass through unchanged.
  - `McpServerSpec` and `McpHttpSpec` each gained an optional `name?: string`
    field so a stable per-server breaker id can be threaded in from the
    caller instead of falling back to `command`/`url`.
  - `mountMcpServer` now computes `serverName = spec.name ?? (url-or-command)`
    and returns `{ tools: wrapToolsWithBreaker(serverName, tools), close }`.
- `src/mcp/mount.ts`
  - `toSpec(entry, authProvider)` now also passes `name: entry.name` into both
    the HTTP and stdio spec branches, so each configured MCP server entry
    gets a distinct, stable breaker id (`mcp:<entry.name>`) rather than one
    derived from the transport (url/command), which is more descriptive and
    avoids collisions when two entries share a command/url.
- `tests/mcp/client-breaker.test.ts` (new): calls `resetBreakers()`, builds a
  `tools` object with one tool whose `execute` always throws, wraps it with
  `wrapToolsWithBreaker('flaky', tools, { threshold: 2, cooldownMs: 10_000 })`,
  calls `execute` twice (swallowing the underlying errors), then asserts the
  third call rejects with `CircuitOpenError`.

## Test
`bun test tests/mcp/client-breaker.test.ts tests/mcp/` → 70 pass, 0 fail
(new test + all pre-existing mcp test files unaffected).

`bun run typecheck` → clean.
`bun run lint:file -- "src/mcp/client.ts" "src/mcp/mount.ts" "tests/mcp/client-breaker.test.ts"` → clean.

## Deviations from the brief (minor, typechecking/linting driven)
- The brief's sample `wrapToolsWithBreaker` used `t.execute!(args, o as never)`
  inside the wrapper; implemented instead by capturing `const execute = t.execute`
  before the ternary and calling `execute(args, o as never)` — same behavior,
  avoids the repo's `lint/style/noNonNullAssertion` rule (forbidden non-null
  assertions), which the raw `!` sample would have tripped.
- The brief's test sample called `wrapped.search.execute({}, {})` directly.
  TS flagged `wrapped.search` as possibly `undefined` and `{}` doesn't
  satisfy the real `ToolExecutionOptions` (`toolCallId`, `messages` required).
  Adjusted the test to `search?.execute?.({}, {} as never)` — preserves the
  exact assertions (two swallowed failures, third rejects with
  `CircuitOpenError`) while satisfying `bun run typecheck` and the
  no-non-null-assertion lint rule.
- Threaded the *entry name* (`entry.name` from `mount.ts`'s `toSpec`) as the
  breaker id source, per the brief's explicit preference ("prefer threading
  the real entry name over the url fallback") rather than relying on the
  url/command fallback in `mountMcpServer` — that fallback still exists for
  direct callers of `mountMcpServer`/`createFileTools`/`createFetchTools` that
  don't go through `mountAll`.

## Concerns
None functional. Note for awareness: `createFileTools`/`createFetchTools`
call `mountMcpServer` directly (bypassing `mountAll`/`toSpec`), so they still
fall back to `spec.command` as the breaker id (`'bun'` vs `'uvx'` — distinct
in practice). Two direct `mountMcpServer` callers sharing the same `command`
and no explicit `name` would collide on one shared breaker — an edge case no
current caller hits, and consistent with the brief's fallback design.

## Commit
`feat(mcp): per-server circuit breaker on tool calls` (SHA 15885df)

## Report path
/Users/inderjotsingh/ai/.superpowers/sdd/task-16-report.md
