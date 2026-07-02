# Task 7 Review-Fix Report: strengthen `withMcpRun` close-after-body test + tighten §14/README accuracy (Slice 16 Task 7 review)

(Note: this filename previously held a stale report from an unrelated
Slice-13 task — "`verify()` primitive". This report replaces it and documents
the Slice-16 Task-7 final-review fix-up only.)

## Findings addressed

### Finding 1 (Important) — `docs/architecture.md` §16 overstated a weak test

`tests/cli/with-mcp-run.test.ts`'s second case ("closes the registry after
the body") previously used `EMPTY_CONFIG` (`entries: []`), so `mountAll`
mounted nothing, the injected `mount.close` mock was never called, and the
test only asserted `expect(closed).toBe(false)` — a no-op that proved
nothing about close-after-body ordering, despite §16's claim that this test
"asserts... the registry is closed after the body runs."

**Fix — strengthened the test so the claim is actually true:**
- Added `ONE_SERVER_CONFIG`, a real `McpConfig` with one well-formed
  `StdioServerEntry` (`{ kind: McpTransportKind.Stdio, name: 'x', command:
  'echo', args: [], env: {}, raw: {...} }`), built from the exact shapes in
  `src/mcp/types.ts`.
- Passed `mountDeps: { consent: { autoYes: true }, approvalsFile: <temp file
  in the test's own tmpdir>, mount: async () => ({ tools: {}, close: async
  () => { order.push('close'); } }) }` so consent passes and the server
  actually mounts (`autoYes: true` short-circuits `ensureConsent`'s TTY
  prompt; a scoped `approvalsFile` avoids touching the repo's
  `.mcp-approvals.json`).
- Recorded ordering into `const order: string[] = []`: the body pushes
  `'body'`, the fake server's `close` pushes `'close'`.
- Asserted `expect(mountedCount).toBe(1)` (via `reg.mounted.length`,
  captured inside the body) as a guard that the server actually mounted —
  so the test would catch a regression where the entry silently fails to
  mount and `close` trivially "passes" by never running.
- Asserted `expect(order).toEqual(['body', 'close'])` — proves close ran
  AND that it ran strictly after the body.

**Verified the strengthened test is load-bearing:** temporarily removed
`await reg.close();` from `withMcpRun`'s `finally` block in
`src/cli/with-mcp-run.ts` and reran `bun test tests/cli/with-mcp-run.test.ts`:

```
error: expect(received).toEqual(expected)
@@ -2,3 +2,3 @@
    "body",
-   "close",
  ]
(fail) withMcpRun > closes the registry after the body [1.85ms]
 1 pass
 1 fail
```

Confirms the test fails exactly as expected when the close-after-body
invariant is broken. Restored the `finally` block immediately after
(`git diff` on `src/cli/with-mcp-run.ts` is empty — no net change to
production code). Reran with the restoration in place: `2 pass, 0 fail`.

### Finding 2 (Minor) — `docs/architecture.md` §14 implied `loadMcpConfig()` ran inside the span

§14's "Load → consent → mount → pin → attach" section read: "`createRun` →
`initRunTelemetry(run.dir)` → `loadMcpConfig()` → `mountAll(config)`, wrapped
in `withMcpMountSpan`" — ambiguous as to whether both calls were wrapped. In
`src/cli/with-mcp-run.ts`, only `mountAll()` runs inside
`withMcpMountSpan`; `loadMcpConfig()` runs just before it, outside any span.

**Fix:** reworded to "`loadMcpConfig()` (outside any span) → `mountAll(config)`,
with only that `mountAll` call wrapped in `withMcpMountSpan`" — precise about
scope.

### Finding 3 (Minor) — README `src/cli/` row omitted `with-mcp-run.ts`

The Project-structure table's `src/cli/` row listed `chat.ts`, `run-chat.ts`,
`select-hook.ts`, `selection-notice.ts`, `mcp.ts` but not `with-mcp-run.ts`
(the Slice-16 run-scope+telemetry+mount helper) — nor `flow.ts`/`crew.ts`,
already-missing entrypoints referenced elsewhere in the same README.

**Fix:** added `flow.ts` (`bun run flow`), `crew.ts` (`bun run crew`), and
`with-mcp-run.ts` ("per-run scope + telemetry + mount helper, Slice 16") to
the row.

## Files changed

- `tests/cli/with-mcp-run.test.ts` — strengthened the second test (real
  mount, ordering assertion) as above; net addition of `ONE_SERVER_CONFIG`
  and the rewritten test body.
- `docs/architecture.md` — §14 "Load → consent → mount → pin → attach"
  paragraph reworded for precision (no other §14/§16 text needed changes;
  §16's original claim is now true given the strengthened test).
- `README.md` — `src/cli/` row in the Project-structure table gained
  `flow.ts`, `crew.ts`, `with-mcp-run.ts`.
- `src/cli/with-mcp-run.ts` — untouched net (temporarily edited to verify
  the test's fail-closed property, then restored; `git diff` confirms no
  change).

## Gate results

- `bun test tests/cli/with-mcp-run.test.ts` → **2 pass, 0 fail, 5 expect()
  calls**.
- Regression check (temporarily removing `reg.close()` from `withMcpRun`'s
  `finally`): **1 pass, 1 fail** — the strengthened test is the one that
  fails, confirming it actually exercises the close-after-body invariant.
  Restored before finishing; full pass count returned to 2/2.
- `bun run docs:check` → `✔ docs-check: living docs present + linked; every
  src subsystem documented.`
- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- "tests/cli/with-mcp-run.test.ts"` → initially flagged
  an import-order issue (`McpTransportKind, type McpConfig` should sort as
  `type McpConfig, McpTransportKind`); fixed; final run clean, no
  errors/warnings.

## Concerns

- None blocking. The strengthened test still uses `mountDeps.mount` as a
  fake (no real subprocess spawn), consistent with how the existing MCP unit
  tests inject fakes for consent/mount deps (per §16) — the real-stdio
  round-trip coverage already lives in `tests/mcp/server.test.ts` and
  `sqlite-server.test.ts`, so this test correctly stays a fast, deterministic
  unit test rather than duplicating that coverage.
