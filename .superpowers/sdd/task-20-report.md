### Task 20: `addPackEntry` check-then-act race → atomic — report

**Files changed:**
- `src/cli/mcp.ts` — `addPackEntry` + its read-modify-write internals
- `tests/mcp/cli-add.test.ts` — awaited existing tests + 2 new concurrent tests

**What was there:** `addPackEntry` in `src/cli/mcp.ts` was a synchronous
function using `existsSync`/`readFileSync`/`writeFileSync`/`renameSync`. The
write itself was crash-atomic (temp file + rename), but there was no guard
against two overlapping read-modify-write sequences on the same `mcp.json`:
read → check `servers[name]` → write, with no re-check immediately before the
write. Because the original implementation had **no `await` boundary
anywhere**, two in-process synchronous calls could never actually interleave
(JS run-to-completion), so the race was real only across two OS processes, or
would become real the moment anyone made the I/O async — a decent bet given
the rest of the codebase is TDD'd against interleaving of exactly this shape.

**Fix:**
1. Converted the critical section to real `async`/`await` I/O
   (`node:fs/promises` `readFile`/`writeFile`/`rename` instead of the sync
   variants) — this is also arguably a correctness fix on its own (no longer
   blocks the event loop), but its main purpose here is to give the function
   genuine `await` points so it's exposed to real interleaving, matching how
   this logged race would actually manifest.
2. Added an in-module async mutex, `withFileLock(path, fn)` — a `Map<string,
   Promise<unknown>>` keyed by `configPath`. Each call chains its critical
   section onto the previous settled promise for that path
   (`tail.then(fn, fn)`), so only one read-modify-write per config path is
   in flight at a time, and each one starts only after the previous one's
   write (including its temp-file + rename) has fully landed. No new
   dependency — it's a plain promise chain.
3. `addPackEntry` is now `Promise<{ ok, message }>`. Updated the one other
   call site (`main()` in the same file) to `await` it, and switched
   `if (import.meta.main) main();` to `main().catch(...)` (matching the
   existing pattern in `src/cli/agent-builder.ts`).
4. Preserved existing semantics exactly: unknown pack name → `ok:false`
   without touching the file; existing entry of the same name → `ok:false`,
   "edit it directly", no write; corrupt JSON → `ok:false` with a message
   (split into an ENOENT-tolerant `readRoot` helper so "file doesn't exist
   yet" and "file exists but is bad JSON" are still distinguished, same as
   before). Each write still uses a temp file + rename (now given a
   per-call unique suffix, `configPath.tmp-<uuid>`, so serialized calls to
   different paths — or even the same path in sequence — never share a temp
   file).

**Why the mutex is necessary and sufficient here:** the queue guarantees the
second call's `readRoot` only happens after the first call's `rename` has
completed, so the second call always observes the first call's write. This
eliminates both failure modes: a lost update (two different entries) and a
duplicate/clobbered entry (same name added twice concurrently — exactly one
wins, matching the pre-existing idempotent/no-clobber contract).

**Test (TDD):** Added `describe('concurrent calls (Slice-15 check-then-act
race)')` in `tests/mcp/cli-add.test.ts` with two cases, both firing two
`addPackEntry` calls without awaiting the first before starting the second:
- different entries (`git`, `time`) → asserts **both** end up in the final
  `mcp.json` (no lost update).
- same entry (`git`, `git`) → asserts exactly one call succeeds and exactly
  one fails, and the file contains a single, correct entry (no duplicate).

**RED confirmed empirically, not just reasoned about:** I temporarily
short-circuited `addPackEntry` to call `writePackEntry` directly (bypassing
`withFileLock`) and reran the focused test file. Both new tests failed
deterministically:
- "different entries" case: `time` entry was written, `git` was lost
  entirely (`parsed.mcpServers.git` was `undefined`) — a genuine lost update.
- "same entry" case: both calls reported `ok:true` — a duplicate/no-clobber
  violation.

This confirms the async-I/O change alone (without the lock) reproduces a
real, deterministic race — it isn't a flaky/timing-dependent artifact — and
that the mutex is what fixes it. Restored the lock afterward; all 6 tests
pass again.

**Verify (inline only, per instructions — full suite not run):**
- `bun run typecheck` → 0 errors.
- `bun run lint:file -- "src/cli/mcp.ts" "tests/mcp/cli-add.test.ts"` → clean
  (ran `biome check --write` once to apply a formatting nit on a wrapped
  `return` line, then re-verified clean).
- `bun run test:file -- "tests/mcp/cli-add.test.ts"` → 6 pass / 0 fail (14
  expect() calls). Confirmed RED-before-fix via the manual lock-bypass
  described above (no `git stash` needed since the new async-with-mutex
  design didn't exist pre-task — bypassing the lock in the new code is the
  equivalent "before" state).

**Concerns / follow-ups (not blocking):**
- The mutex is process-local. Two separate OS processes (e.g. two
  concurrent `bun run mcp add ...` CLI invocations) can still race, since an
  in-process promise chain can't coordinate across processes. The task brief
  explicitly scoped this to the in-process case ("If calls are in-process,
  serialize via promise-chain mutex"); true cross-process safety would need
  OS-level file locking (e.g. `flock`) or a lockfile protocol, which is a
  larger change and out of scope here.
- `fileLocks` grows one entry per distinct `configPath` ever passed and is
  never evicted. In practice this is a handful of paths per process
  lifetime (CLI runs are short-lived, tests use fresh temp dirs), so this is
  not a real leak in practice, but noting it for completeness.
