# Task 4 report — A2A least-privilege skill allowlist store + ref resolution (§7.4, Slice 31)

**Status:** DONE. Commit `884f785` — `feat(a2a): least-privilege skill allowlist store + author-time ref resolution`.

## Implemented
- `src/a2a/allowlist.ts` — `SkillEntry` / `ResolvedTarget` / `A2aAllowlist` types + `AllowlistError`, `createA2aAllowlist({ path? })`, `refExistsFor(kind, ref)`, exactly per the brief's Produces block.
  - File format `{ skills: SkillEntry[] }` at `AGENT_A2A_SKILLS_PATH` (default resolved via `loadConfig().values.AGENT_A2A_SKILLS_PATH` when no `path` passed).
  - Atomic-write `persist()` (0700 dir / 0600 temp file / temp+rename, best-effort temp cleanup) and fail-closed `load()` copied byte-for-byte in structure from `src/server/security/device-registry.ts`.
  - `put()` validates `refExistsFor` and throws `AllowlistError` on a non-existent ref; upserts on `skillId`; field-strips to the 5 persisted fields (defense-in-depth).
  - `resolve()` re-reads from disk and returns `{ kind, ref }` only for an exact listed `skillId`, else `undefined`.
- `tests/a2a/allowlist.test.ts` — brief's 3 tests verbatim + a 4th fail-closed-on-corrupt-file test.

## TDD evidence
**RED** (`bun run test:file -- "tests/a2a/allowlist.test.ts"`):
```
error: Cannot find module '../../src/a2a/allowlist.ts' ...
 0 pass  1 fail  1 error
```
**GREEN** (same command, after implementation):
```
 4 pass  0 fail  5 expect() calls
Ran 4 tests across 1 file.
```

## Gate
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/a2a/allowlist.ts tests/a2a/allowlist.test.ts` → `Checked 2 files. No fixes applied.` (one formatter line-wrap fixed pre-commit).
- pre-commit `docs-check` → passed (`src/a2a` already documented).

## Files changed
- `src/a2a/allowlist.ts` (new)
- `tests/a2a/allowlist.test.ts` (new)

## §7.4 security self-review
1. **Any path to expose an unregistered ref?** No. `put()` is the only write path and it hard-throws unless `refExistsFor(kind, ref)` is true. `refExistsFor` was **hardened beyond the brief's `!!AGENTS[ref]`**: it uses `Object.hasOwn(AGENTS, ref)` so prototype-chain names (`constructor`, `__proto__`, `toString`) cannot resolve to inherited members and slip an unregistered ref past the guard — matching the `Object.hasOwn` discipline already in `getCrew`/`getWorkflow`. There is no wildcard, default, or "run anything" entry — every entry names a concrete registered ref.
2. **Can `resolve` return non-undefined for an unlisted id?** No. It re-reads the store and returns via exact `skillId` `.find`; a miss returns `undefined` with no fall-through target. The server resolves-then-rejects.
3. **Is the load genuinely fail-closed?** Yes. ABSENT file → `[]` (legit "nothing exposed"); PRESENT-but-corrupt (invalid JSON **or** not the `{ skills: [] }` shape) → throws. `resolve` also re-reads via the same `load`, so a store tampered post-boot fails closed at invoke time too. Directly tested (corrupt-file test asserts `.list()` throws, never returns empty).

## Concerns
- `resolve()` intentionally does NOT re-run `refExistsFor` at invoke time (per design: the allowlist is the exposure boundary; the dispatcher does the final target-existence check). If a registered agent/crew is later unregistered, `resolve` still returns its `{kind,ref}` and the server-side dispatch is expected to reject on the missing target ("resolve-then-reject"). Matches the brief but relies on the downstream INVOKE task honoring that final check.
- `resolve()` re-reads from disk on every call (no cache) — correct for live revocation, minor per-invoke I/O cost; acceptable for the A2A invoke path.

## Fix wave (§7.4 hardening)

Two Important security-hardening fixes applied on top of `884f785`.

### Fix 1 — restrict exposable kinds to {Chat, Crew, Workflow}
`refExistsFor(kind, ref)` previously fell through for ANY non-Workflow/Crew kind
into the agent/crew lookup, so `kind=JobKind.Pull`/`JobKind.Build` with a
registered agent ref was accepted — exposing model-pull/builder jobs as A2A
skills. Rewrote it as an explicit `switch (kind)`:
- `Workflow` → `!!getWorkflow(ref)`
- `Crew` → `!!getCrew(ref)`
- `Chat` → `Object.hasOwn(AGENTS, ref) || !!getCrew(ref)` (prototype-safe kept)
- `default` (Pull/Build/anything else) → `false`
`put({kind: JobKind.Pull, ref:'file_qa'})` now throws `AllowlistError`.

### Fix 2 — re-validate on resolve + validate kind on load
- `resolve(skillId)`: after finding the listed entry, re-runs
  `refExistsFor(entry.kind, entry.ref)`; if false (ref de-registered, or kind
  not in {Chat,Crew,Workflow}) it returns `undefined` (treated as unlisted).
  The allowlist is now fail-safe on its own, not reliant on a downstream INVOKE
  consumer.
- `load()`: added `isJobKind()` (a Set of `Object.values(JobKind)`) to the
  entry filter, dropping entries whose `kind` is not a valid `JobKind` member —
  consistent with the existing malformed-entry drop. Fail-closed-on-unparseable
  behavior unchanged.

### RED → GREEN evidence (3 new tests)
Command: `bun run test:file -- "tests/a2a/allowlist.test.ts"`

RED (tests written before the impl fixes):
```
(fail) put rejects a non-exposable kind even with a registered ref (Pull, §7.4)
(fail) resolve re-validates the ref: an unregistered ref resolves to undefined
(fail) load drops an entry with a kind that is not a valid JobKind (garbage_kind)
 4 pass
 3 fail
Ran 7 tests across 1 file.
```

GREEN (after Fix 1 + Fix 2):
```
 7 pass
 0 fail
Ran 7 tests across 1 file.
```
The original 4 tests remain green (put valid; put rejects unregistered ref;
resolve undefined for unlisted; load fails closed on corrupt store).

### Gate
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/a2a/allowlist.ts tests/a2a/allowlist.test.ts` →
  `Checked 2 files. No fixes applied.`
