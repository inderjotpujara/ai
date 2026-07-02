# Task 2 Report: Consent interactivity predicate + stdin `end` handling (Slice 16)

> Note: this file previously held a Slice 15 Task 2 report (consent store +
> hashing). That work already landed and is preserved in git history and in
> `.superpowers/sdd/progress.md`. This file is overwritten here to hold the
> current Slice 16 Task 2 report, per this task's brief.

## Status

**DONE**
**Commit:** `63380483e9d1189f025765291b021e6be629ea34` on branch `slice-16-mcp-telemetry-ordering`

## What was built

**Bug:** `src/mcp/mount.ts` decided prompt interactivity from `process.stderr.isTTY`
but read the answer from `process.stdin`. Running `bun run flow … < /dev/null`
(interactive terminal, stdin redirected) made `stdinInput()`'s promise never
settle — no `data` ever arrives and there was no `end` handler — so the process
hung forever waiting on an already-ended stdin.

**Fix**, in two files:

1. **`src/provisioning/ui/prompt.ts`**:
   - `stdinInput()` now takes an optional `stream: NodeJS.ReadStream = process.stdin`
     parameter (was hardcoded to `process.stdin`, making it untestable without
     real stdin). Its `read()` promise now also listens for the stream's `end`
     event and resolves `''` on it, alongside the existing `data` handler —
     both paths share a `cleanup()` that removes both listeners.
   - New `interactiveTTY(stdin: { isTTY?: boolean } = process.stdin, stderr: { isTTY?: boolean } = process.stderr): boolean`
     — returns `true` only when **both** are TTYs (`(stdin.isTTY ?? false) && (stderr.isTTY ?? false)`).
2. **`src/mcp/mount.ts`**:
   - Imports `interactiveTTY` alongside the existing `askYesNo`, `stdinInput`.
   - `consent.isTTY` is now `interactiveTTY()` instead of `process.stderr.isTTY ?? false`.

Test files:
- **`tests/provisioning/prompt.test.ts`** — new file (didn't exist before). Two
  `describe` blocks: `interactiveTTY` (4-case truth table) and `stdinInput`
  (data-resolves case + the new end-resolves-empty regression case).
- **`tests/mcp/mount-all.test.ts`** — extended with one new `it(...)` inside the
  existing `describe('mountAll', ...)` block (see file-naming note below).

## File-naming discrepancy: `mount.test.ts` vs `mount-all.test.ts`

The task brief pointed at `tests/mcp/mount.test.ts`, describing it as a file that
"already imports `mountAll` and builds `McpConfig` fixtures." That description
does not match the actual `tests/mcp/mount.test.ts` on disk: that file has a
single `test()` (flat bun:test style, no `describe`) that mounts the real
`src/mcp/server.ts` stdio subprocess via `mountMcpServer` — no `mountAll` or
`McpConfig` fixtures at all. It was left untouched.

The file that matches the brief's description (`describe`/`it` style, imports
`mountAll`, `entry()`/`deps()`/`fakeServer()` fixture helpers, `McpConfig`
literals) is `tests/mcp/mount-all.test.ts`. The new regression test was added
there, inside the existing `describe('mountAll', ...)` block, reusing that
file's own helpers rather than the brief's literal snippet (which used ad hoc
`mkdtemp`/inline object literals) — keeping the addition idiomatic to the file
it actually lives in:

```ts
it('skips consent-gated servers non-interactively without calling ask (no hang)', async () => {
  let asked = 0;
  const config: McpConfig = {
    entries: [entry('needs-consent')],
    dormant: [],
    warnings: [],
  };
  const reg = await mountAll(
    config,
    deps({
      consent: {
        isTTY: false,
        autoYes: false,
        ask: async () => {
          asked += 1;
          return true;
        },
      },
      mount: async () => fakeServer([]),
    }),
  );
  expect(asked).toBe(0);
  expect(reg.skipped.some((s) => s.name === 'needs-consent')).toBe(true);
});
```

## `ensureConsent` non-interactive path — confirmed before writing the test

Per the brief's instruction, read `src/mcp/consent.ts::ensureConsent`
(lines 136–170) before writing the regression test. Confirmed the
`isTTY:false && !autoYes && !approved` branch:

```ts
if (!deps.isTTY) {
  deps.warn(
    `MCP server "${entry.name}" is not approved yet and this is not a TTY — skipping (run interactively or set AGENT_MCP_AUTO_APPROVE=1)`,
  );
  return false;
}
```

returns `false` (skip) directly, without ever calling `deps.ask`. So
`ensureConsent` itself was already correct and needed no change — the actual
bug was entirely in how `mount.ts` computed the `isTTY` value it passed in.
The new `mount-all.test.ts` case is a regression guard that this wiring stays
intact (with `consent.isTTY: false, autoYes: false`, `ask` must never be
called and the entry must land in `reg.skipped`), not a test of the fix
itself — consistent with the brief's expectation that this test would already
pass before the fix.

## TDD evidence (RED → GREEN)

**RED** — before implementing `interactiveTTY` / the updated `stdinInput`:

```
$ bun test tests/provisioning/prompt.test.ts
bun test v1.3.11 (af24e281)

tests/provisioning/prompt.test.ts:

# Unhandled error between tests
-------------------------------
1 | })
2 | {
    ^
SyntaxError: Export named 'interactiveTTY' not found in module '/Users/inderjotsingh/ai/src/provisioning/ui/prompt.ts'.
      at loadAndEvaluateModule (2:1)
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [15.00ms]
```

(This confirms the missing export; had the module loaded, the `end` test would
have hung against the old `stdinInput`, which registered no `end` listener.)

`tests/mcp/mount-all.test.ts`'s new test was **not** expected to be RED per the
brief, since it exercises `ensureConsent`'s pre-existing skip path directly,
not the new predicate. Verified it passed (8/8 in the file) before any
implementation changes — confirming it's a regression guard, not a bugfix
test.

**GREEN** — after implementing `stdinInput`/`interactiveTTY` in `prompt.ts` and
wiring `interactiveTTY()` into `mount.ts`:

```
$ bun test tests/provisioning/prompt.test.ts tests/mcp/mount-all.test.ts tests/mcp/mount.test.ts
bun test v1.3.11 (af24e281)

 12 pass
 0 fail
 22 expect() calls
Ran 12 tests across 3 files. [210.00ms]
```

No hang; both runs (before and after a subsequent formatting fix) completed
well under bun's default per-test timeout.

## Gate results

- **`bun run typecheck`** → clean (`tsc --noEmit`, no output/errors).
- **`bun run lint:file -- "src/provisioning/ui/prompt.ts" "src/mcp/mount.ts" "tests/provisioning/prompt.test.ts" "tests/mcp/mount-all.test.ts"`**
  → initially flagged 2 formatting-only issues: biome wanted the new 3-name
  imports (`askYesNo, interactiveTTY, stdinInput`) wrapped across multiple
  lines rather than on one line. Fixed by wrapping both import statements;
  re-run → `Checked 4 files in 14ms. No fixes applied.` (clean, no logic
  changes).
- **`bun test tests/mcp/ tests/provisioning/`** (full suites, 27 files) →
  **114 pass, 0 fail, 238 expect() calls**, 35.91s. No regressions in either
  subsystem.
- **`bun run docs:check`** ran automatically via the pre-commit hook → passed
  (`✔ docs-check: living docs present + linked; every src subsystem
  documented`). No `docs/architecture.md` change was needed: this is a
  bugfix inside already-documented subsystems (`src/mcp`, `src/provisioning`),
  not a new subsystem, new mechanism, or externally-visible behavior change
  at the architecture-doc level — the module boundaries and data flow are
  unchanged, only the interactivity predicate's correctness.

## Files changed

- `src/provisioning/ui/prompt.ts` (modified) — `stdinInput` now takes an
  optional stream param and handles `end`; added `interactiveTTY`.
- `src/mcp/mount.ts` (modified) — imports and uses `interactiveTTY()` instead
  of `process.stderr.isTTY ?? false`.
- `tests/provisioning/prompt.test.ts` (new, 34 lines) — `interactiveTTY` +
  `stdinInput` unit tests, exactly per the brief.
- `tests/mcp/mount-all.test.ts` (modified, +24 lines) — no-hang regression
  test added to the existing `mountAll` describe block.

**Commit:** `63380483e9d1189f025765291b021e6be629ea34` — "fix(mcp): consent
judges TTY on the stream it reads (stdin) + stdin end resolves empty (Slice 16
Task 2)" on branch `slice-16-mcp-telemetry-ordering`.

## Concerns

None blocking. One documentation discrepancy noted above and recorded for
whoever reviews Slice 16: the brief's file pointer (`tests/mcp/mount.test.ts`)
didn't match its own description of that file's contents — the file matching
the description (`mount-all.test.ts`) was used instead, and `mount.test.ts`
was left untouched.

## Review fix: regression guard for `mount.ts`'s `isTTY: interactiveTTY()` wiring

**Finding (Important):** the existing no-hang test above (`'skips
consent-gated servers non-interactively without calling ask (no hang)'`)
passes `consent: { isTTY: false, ... }` explicitly. Because `mount.ts` spreads
`...deps.consent` *after* `isTTY: interactiveTTY()` (line ~67), that test's
own `isTTY: false` always wins — it never exercises `interactiveTTY()` itself.
Reverting `mount.ts` line 67 back to `isTTY: process.stderr.isTTY ?? false`
(the pre-Task-2 bug) would leave every existing test green, i.e. there was no
regression guard on the actual wiring line.

**Fix:** added one new test to `tests/mcp/mount-all.test.ts`, inside the
`describe('mountAll', ...)` block, right after the existing no-hang test:

```ts
it('stderr-is-TTY but stdin-is-not (cmd < /dev/null) still skips without asking', async () => {
  // Regression guard for mount.ts's `isTTY: interactiveTTY()` wiring: judging
  // TTY-ness off `process.stderr.isTTY` alone (the old, buggy wiring) would
  // read true here and attempt to prompt — which hangs when stdin is closed.
  // The fix requires BOTH stdin and stderr to be TTYs, so this must skip.
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stderrDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  try {
    let asked = 0;
    let mountCalls = 0;
    const config: McpConfig = {
      entries: [entry('needs-consent')],
      dormant: [],
      warnings: [],
    };
    const reg = await mountAll(
      config,
      deps({
        // Deliberately omit isTTY here so mount.ts's own
        // `isTTY: interactiveTTY()` wiring is what gets exercised.
        consent: {
          autoYes: false,
          ask: async () => { asked += 1; return true; },
        },
        mount: async () => { mountCalls += 1; return fakeServer([]); },
      }),
    );
    expect(asked).toBe(0);
    expect(mountCalls).toBe(0);
    expect(reg.skipped.some((s) => s.name === 'needs-consent')).toBe(true);
  } finally {
    if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
    if (stderrDescriptor) Object.defineProperty(process.stderr, 'isTTY', stderrDescriptor);
  }
});
```

This scenario (stderr is a TTY, stdin is not — `cmd < /dev/null` on an
interactive terminal) is the one the bug actually manifests in: judging
solely on `process.stderr.isTTY` reads `true`, so the old code would attempt
to prompt (and hang on real stdin). `deps.consent` here deliberately omits
`isTTY` (only sets `ask` + `autoYes: false`), so `mount.ts`'s own
`isTTY: interactiveTTY()` line is what actually resolves the value — unlike
every prior test in the file, which sets `consent.isTTY` explicitly and thus
short-circuits past that line via the later `...deps.consent` spread.

**Regression-catch verification (as required by the review):**

1. Reverted `src/mcp/mount.ts` line 67 to the pre-fix
   `isTTY: process.stderr.isTTY ?? false`, kept everything else unchanged, ran
   `bun test tests/mcp/mount-all.test.ts`:

   ```
   error: expect(received).toBe(expected)
   Expected: 0
   Received: 1
     at tests/mcp/mount-all.test.ts:223:21
   (fail) mountAll > stderr-is-TTY but stdin-is-not (cmd < /dev/null) still skips without asking [0.65ms]
   8 pass
   1 fail
   ```

   Confirmed FAIL — `asked` became `1` because the buggy wiring read
   `isTTY: true` (stderr alone) and called `ask`. (The test's fake `ask`
   resolves immediately rather than reading real stdin, so this failed fast
   instead of hanging — appropriate for a unit test asserting the wiring
   itself, since a real hang is exactly what the fix in Task 2 already
   prevents and is covered by the `stdinInput` `end`-handling tests in
   `tests/provisioning/prompt.test.ts`.)

2. Restored `src/mcp/mount.ts` line 67 to `isTTY: interactiveTTY()` (`git diff`
   on the file confirmed byte-for-byte back to the committed fix — empty
   diff), re-ran the same command:

   ```
   bun test v1.3.11 (af24e281)
    9 pass
    0 fail
   18 expect() calls
   Ran 9 tests across 1 file. [54.00ms]
   ```

   Confirmed PASS — all 9 tests in the file, including the new one.

**Gate results:**
- `bun test tests/mcp/mount-all.test.ts` → 9 pass, 0 fail.
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- "tests/mcp/mount-all.test.ts"` → clean
  (`Checked 1 file in 36ms. No fixes applied.`).

**Files changed:** `tests/mcp/mount-all.test.ts` only (test-only change, no
production code touched — `src/mcp/mount.ts` is unmodified from the Task 2
commit).
