# Slice 16 — MCP telemetry-ordering fix + consent robustness

**Date:** 2026-07-02
**Status:** Design (awaiting user review)
**Type:** Hardening / correctness slice (no new capability)
**Branch:** `slice-16-mcp-telemetry-ordering`

## 1. Why this slice

The Slice 15 final review landed a **binding condition**: the first engineering
item of the next slice must fix the `mcp.mount` span/run-telemetry ordering gap.
This slice discharges that condition and the only other code-level MCP debt
logged against the same follow-on. Everything else on the non-OAuth MCP
follow-on list is either verification-only (gated on external creds/TTY) or
deliberately deferred to its own slice / "do not build" — see §7.

Scope (user-confirmed): **the binding fix + two bundled minors**, plus whatever
live-verify we can actually run.

## 2. The three defects (verified against the code)

### ① `mcp.mount` span is emitted before telemetry is initialized (BINDING)

`withMcpMountSpan` resolves its tracer from the OpenTelemetry **global**
provider at span-creation time (`spans.ts` → `inSpan` → `trace.getTracer('agent')`).
That global provider is the no-op provider until `initRunTelemetry(runDir)`
installs the run-scoped `BasicTracerProvider` (`provider.ts:52-53`, which even
calls `trace.disable()` first).

In all three CLIs the mount pass runs in `main()` **before** the run function
installs telemetry:

| CLI | mount + `withMcpMountSpan` | `initRunTelemetry` |
|-----|----------------------------|--------------------|
| `flow.ts` | `main()` line 138-145 | inside `runFlow`, line 75 |
| `crew.ts` | `main()` line ~90 | inside `runCrewCli`, line ~30 |
| `chat.ts` | `main()` line ~109 | inside `runChat` (`run-chat.ts:20`) |

Result: the `mcp.mount` span and its `mcp.server.mount` events are created
against the no-op tracer and **silently dropped** — they never reach
`runs/<id>/spans.jsonl`. The §14 telemetry claim ("mount is observable") is
therefore false today.

**Root cause is structural:** "establish the run scope (run dir + telemetry
provider)" and "mount MCP + emit its span" are ordered correctly nowhere,
because the ordering is implicit across three separate `main()` functions. It
broke in all three at once for exactly that reason.

### ② Root-span `mcp.tool.count` actually holds a server count

`spans.ts:430`: `span.setAttribute(ATTR.MCP_TOOL_COUNT, servers)`. `servers` is
incremented on **every** `record()` call (`spans.ts:420`) — including `skipped`
and `dormant` outcomes — so the attribute named "tool count" holds neither a
tool count nor even a mounted-server count. The per-server `mcp.server.mount`
event's `MCP_TOOL_COUNT` (set from the real per-server `toolCount`,
`spans.ts:424-426`) is correct; only the root-span aggregate is wrong.

### ③ Consent judges interactivity on stderr but reads stdin (can hang)

`mount.ts:63`: `isTTY: process.stderr.isTTY ?? false`. But the answer is read
from **stdin** via `stdinInput()` (`mount.ts:59` → `prompt.ts:4-17`, which reads
`process.stdin`). With `bun run flow … < /dev/null` (an interactive terminal
with stdin redirected), `isTTY` is judged `true` from stderr, `askYesNo` is
called, and `stdinInput().read()` registers a `data` listener on an
already-ended stdin that never fires — `prompt.ts:6-15` has no `end`/`close`
handler, so the CLI **hangs forever** waiting for input that can't arrive.

## 3. Approach (chosen: shared `withMcpRun` helper)

Extract one helper that owns the entire per-run CLI scope so the ordering
invariant lives in exactly one tested place and cannot regress per-CLI:

```
src/cli/with-mcp-run.ts

export type McpRunContext = {
  run: RunHandle;         // { id, dir } from createRun
  reg: MountedRegistry;   // .merged, .forAgent(), .mounted, .skipped, .close()
  config: McpConfig;      // for warnUnknownAgents + dormant listing
};

export async function withMcpRun<T>(
  opts: {
    runsRoot: string;
    runId: string;
    config?: McpConfig;        // injectable for tests; defaults to loadMcpConfig()
    mountDeps?: MountAllDeps;  // injectable stub mount for tests
  },
  body: (ctx: McpRunContext) => Promise<T>,
): Promise<T> {
  const run = await createRun(opts.runsRoot, opts.runId);
  const tel = initRunTelemetry(run.dir);              // (1) provider live FIRST
  const config = opts.config ?? loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => { // (2) span now lands
    const r = await mountAll(config, opts.mountDeps);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    return await body({ run, reg, config });           // (3) per-CLI work
  } finally {
    await reg.close();                                 // (4) teardown, in order
    await tel.shutdown();
  }
}
```

**Consequences:**
- `runFlow` / `runCrewCli` / `runChat` **stop** calling `createRun` /
  `initRunTelemetry` / `tel.shutdown()`. They receive the already-created
  `run: RunHandle` and execute within the ambient (already-installed) provider.
- Their deps drop `runsRoot: string; runId: string` and gain `run: RunHandle`.
  This is the signature change the final review anticipated
  (`FlowDeps`, `CrewCliDeps`, and `ChatDeps` in `run-chat.ts`).
- Each `main()` becomes: parse args → `withMcpRun({runsRoot,runId}, async ({run,reg,config}) => { …build agents/tools from reg, run the run-fn, print outcome… })`.
  The mount-region duplication (currently ~8 lines in each `main()`) collapses
  into the helper.
- The memory CLI (which inits telemetry but does not mount MCP) is out of scope
  and unchanged.

**Rejected alternatives:** (B) hoist `createRun`+`initRunTelemetry` per-`main()` —
re-implements the ordering invariant in three places, same fragility that caused
the bug. (C) mount-inside-run — pushes MCP lifecycle into three run functions
and duplicates the mount block. Both leave the invariant implicit; A makes it
singular and testable.

### Minor ② fix

In `withMcpMountSpan`, track two honest aggregates and set both on the root span:
- `ATTR.MCP_SERVER_COUNT` (new attribute, `'mcp.server.count'`) = number of
  servers that actually **mounted** (outcome `'mounted'`).
- `ATTR.MCP_TOOL_COUNT` = **sum** of the per-server `toolCount`s (mounted only).

The per-server event semantics are already correct and stay unchanged.

### Minor ③ fix

Two layers of defense:
1. **Correct the predicate** — interactivity requires the stream we *read* to be
   a TTY: `isTTY: (process.stdin.isTTY ?? false) && (process.stderr.isTTY ?? false)`.
   When stdin is `/dev/null`/piped, this is `false` → consent falls to the
   non-interactive path (skip, the existing safe default) instead of prompting.
2. **Harden `stdinInput`** — add an `end`/`close` handler that resolves `''`
   (treated as "N") so a read on an ended stdin can never hang, even if some
   future caller reaches it. Belt-and-suspenders behind the predicate fix.

`mountAll` already spreads `deps.consent` (`mount.ts:66`), so tests inject
`isTTY` directly; the predicate change only affects production defaults, keeping
blast radius small.

## 4. Data flow (after)

```
main(flow|crew|chat)
  └─ withMcpRun({runsRoot, runId})
       ├─ createRun            → runs/<id>/           (run dir)
       ├─ initRunTelemetry     → installs run-scoped provider  ← BEFORE mount
       ├─ withMcpMountSpan(mountAll)                            ← span now exported
       │     └─ per-server mcp.server.mount events + root mcp.server.count/mcp.tool.count
       └─ body({run, reg, config})
             └─ build agents/tools from reg → runFlow/runCrewCli/runChat(run, …)
                   └─ withWorkflowSpan(…) → workflow/agent/tool spans (provider live)
       finally: reg.close() → tel.shutdown() (flush spans.jsonl)
```

## 5. Testing (TDD, RED first)

1. **Ordering regression test (the binding proof).** Drive `withMcpRun` with a
   stub `mountDeps.mount` (no real servers) into a temp `runsRoot`, then read
   `runs/<id>/spans.jsonl` and assert an `mcp.mount` span is present with its
   `mcp.server.mount` events. This FAILS today (span dropped) and PASSES after.
   A companion assertion checks the same for a real run-fn body so the end-to-end
   path is covered, not just the helper in isolation.
2. **Minor ② unit test.** Exercise `withMcpMountSpan` with a recorded mix
   (2 mounted w/ tool counts, 1 skipped, 1 dormant) via an in-memory span
   capture; assert root span `mcp.server.count === 2` and
   `mcp.tool.count === sum(toolCounts)`; assert per-server events unchanged.
3. **Minor ③ tests.** (a) predicate: stdin non-TTY ⇒ `mountAll` takes the
   non-interactive path and returns without invoking `ask` / without hanging
   (assert within a timeout, injected `consent`); (b) `stdinInput` resolves `''`
   on stream `end`.
4. **Signature-migration tests.** Update existing `runFlow`/`runCrewCli`/
   `runChat` tests to the new `run: RunHandle` deps; no behavior assertions
   should change beyond who creates the run.

## 6. Standing notes

**Architecture-doc update (§14 Telemetry + CLI section).** Remove the "mount
span is currently a no-op / never lands" caveat; document `withMcpRun` as the
CLI run-scope owner (run dir + telemetry + mount, in that order); document the
new `mcp.server.count` attribute and corrected `mcp.tool.count` semantics. Add
the `src/cli/with-mcp-run.ts` unit to the module map. Update README slice table
(+ Slice 16 row) and ROADMAP (flip the follow-on marker; strike the binding
condition as discharged). Regenerate the snapshot Artifact (new CLI-helper node,
footer → "16 slices · <N> tests").

**Telemetry to emit.** `mcp.mount` span + `mcp.server.mount` events now actually
exported to `runs/<id>/spans.jsonl`; new `mcp.server.count` attribute; corrected
`mcp.tool.count` (true summed tool count). No new span *kinds* — this makes an
already-specified span real.

## 7. Explicitly out of scope (logged, not silently dropped)

- **OAuth for remote servers** — user-excluded from this slice.
- **GitHub remote-HTTP live-verify** — verification-only, gated on a `GITHUB_PAT`
  (static key). Runnable in this slice only if the user supplies a token.
- **Interactive consent-prompt TTY spot-check** — the ③ fix makes the
  non-interactive path safe; the *interactive* y/N path is unit-tested and gets
  the user's ~30s manual confirmation as part of live-verify.
- **Deferred by design:** Codex delegate (own slice), live registry query
  (blocked on GA), shell server (needs sandbox design), `list_changed`/
  notifications (pinning is the posture), roots/sampling (deprecating),
  spec-2026-07-28 / SDK-v2 migration (blocked on SDK v2).

## 8. Files touched (estimate)

- **New:** `src/cli/with-mcp-run.ts`, `tests/cli/with-mcp-run.test.ts`,
  `tests/mcp/mount-span.test.ts` (or extend `tests/mcp/tool-span.test.ts`).
- **Changed:** `src/cli/flow.ts`, `src/cli/crew.ts`, `src/cli/chat.ts`,
  `src/cli/run-chat.ts`, `src/telemetry/spans.ts` (minor ②),
  `src/mcp/mount.ts` + `src/provisioning/ui/prompt.ts` (minor ③), plus the
  affected existing CLI tests. Docs: `architecture.md`, `README.md`, `ROADMAP.md`.
