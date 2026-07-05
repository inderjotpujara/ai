# Task 10 report: OAuth token store (0600 file)

**Status:** DONE

**Commit:** `793cb0a` — feat(mcp): 0600 OAuth token store

## What was built

`src/mcp/token-store.ts`, mirroring the atomic temp+rename pattern from
`src/mcp/consent.ts`'s `writeApprovals`, hardened for secrets:

- `StoredTokens`, `ClientRecord`, `ServerAuthRecord` types per the brief.
- `tokenStorePath()` — `$XDG_CONFIG_HOME || ~/.config` + `/ai/mcp-tokens.json`.
- `readTokenStore(path?)` — missing or corrupt file → `{}`, never throws
  (same defensive posture as `readApprovals`).
- `writeTokenStore(store, path?)` — atomic write:
  - `mkdirSync(dirname(path), { recursive: true, mode: 0o700 })` for the
    parent dir.
  - temp file written with `writeFileSync(tmp, ..., { mode: 0o600 })`.
  - `renameSync(tmp, path)`.
  - explicit `chmodSync(path, 0o600)` after rename as a belt-and-suspenders
    check (rename generally preserves the temp's mode on the same
    filesystem, but this guarantees it regardless).
- `getServerAuth(server, path?)` / `setServerAuth(server, rec, path?)` —
  read-modify-write; `setServerAuth` replaces the named server's whole
  record in the store object (store-level merge — other servers'
  records untouched) then persists via `writeTokenStore`.
- Left an explicit comment on `tokenStorePath()` noting this file holds
  real OAuth secrets in plaintext, protected only by 0600 permissions —
  encryption-at-rest is deliberately deferred to Slice 35.

## Test coverage

`tests/mcp/token-store.test.ts`, 8 tests, all passing:
1. Round-trips tokens for one server and asserts `statSync(path).mode & 0o777 === 0o600` (brief's required test).
2. Missing file via `getServerAuth` → `{}`, never throws (brief's required test).
3. `readTokenStore` on a missing file → `{}`.
4. `readTokenStore` on a corrupt (non-JSON) file → `{}`, never throws.
5. `setServerAuth` merges into an existing store, other servers' records preserved.
6. `setServerAuth` overwrites/replaces the record for the same server (verifies store-level, not deep-field, merge semantics).
7. `writeTokenStore` creates the parent dir with mode `0o700` and the file with `0o600`, including nested dirs that don't yet exist.
8. `tokenStorePath()` resolves to a path ending in `ai/mcp-tokens.json` by default.

All tests use `node:os` `tmpdir()` paths — none touch the real `~/.config`.

## Verification run

```
bun test tests/mcp/token-store.test.ts   → 8 pass, 0 fail
bun run typecheck                        → clean
bun run lint:file src/mcp/token-store.ts tests/mcp/token-store.test.ts → clean (biome, no fixes needed)
```

Manual spot-check (outside the test suite) confirmed the final file's mode
is `0600` after a real `setServerAuth` call, and that the default
`tokenStorePath()` resolves to `~/.config/ai/mcp-tokens.json` when
`XDG_CONFIG_HOME` is unset.

## Self-review notes

- Confirmed 0600 is set on both the temp file (at write time) AND the
  final file (via explicit `chmodSync` post-rename) — never leaves a
  world-readable window for the secrets file, satisfying the brief's
  "set both to be safe" instruction.
- `mkdirSync(..., { mode: 0o700 })` only applies the mode when the
  directory is actually created; if a parent dir pre-exists with looser
  permissions, `mkdirSync` won't tighten it. This matches the brief's
  literal instruction and mirrors how `consent.ts` doesn't harden
  pre-existing dirs either. Flagging as a known limitation, not a defect
  introduced here — `~/.config` and `~/.config/ai` typically pre-exist
  with normal user-only-writable perms in practice, and this store is
  additive to that convention.
- No behavior for concurrent writers (two processes racing on the same
  temp file path) — same limitation as `consent.ts`; out of scope for
  this task.
- `docs/architecture.md`/README/ROADMAP were not touched: `src/mcp` is
  already a documented subsystem, `bun run docs:check` (which runs as
  part of the pre-commit hook) passed with no changes needed. No new
  top-level subsystem was introduced.

## Concerns for downstream tasks (12/14)

- `setServerAuth`'s "merge" is store-level (replaces the named server's
  entire `ServerAuthRecord`), not a deep merge of `tokens`/`codeVerifier`/
  `client` sub-fields. If Task 12/14 need to update just one sub-field
  (e.g., refresh `tokens` while preserving an existing `client` record),
  callers must read the existing record via `getServerAuth` first, spread
  it, and pass the merged object to `setServerAuth` — the store won't do
  that merge for them. Confirmed this matches the "merge + persist"
  wording in the brief (merge into the store, not into the record), and
  no other task brief currently references a different expectation.
- Did not touch any of the other `.superpowers/sdd/*.md` files or
  `docs/ROADMAP.md` showing as modified in `git status` — those diffs
  predate this task's work (other Slice 26 tasks running in parallel) and
  were deliberately left out of this commit's staged files.

---

## Fix: `setServerAuth` was a whole-record REPLACE, not a field merge

**Reported by:** live review of Task 10, in the context of Task 12's
call pattern (save `codeVerifier`, then save `client`, then save
`tokens` as three separate `setServerAuth` calls during the OAuth
handshake).

**Bug:** `setServerAuth` did `store[server] = rec`. Each call fully
replaced the server's stored record, so a later call (e.g. saving
`tokens` after exchange) silently wiped fields set by an earlier call
(e.g. `codeVerifier` set before the redirect). This is exactly the
"concerns for downstream tasks" limitation flagged above, but it turned
out to be a functional defect rather than an acceptable caller
responsibility — Task 12's PKCE handshake needs `codeVerifier` to
survive until the token exchange call, and nothing in that flow
re-reads-and-spreads before calling `setServerAuth`.

**Fix (`src/mcp/token-store.ts`):**

```ts
export function setServerAuth(
  server: string,
  rec: ServerAuthRecord,
  path: string = tokenStorePath(),
): void {
  const store = readTokenStore(path);
  store[server] = { ...store[server], ...rec };
  writeTokenStore(store, path);
}
```

Shallow merge is sufficient: `tokens`, `codeVerifier`, and `client` are
the only three top-level keys on `ServerAuthRecord`, and each caller
always sets a complete sub-object for the key(s) it's writing (never a
partial `tokens` or partial `client`), so a shallow spread can't produce
a Frankenstein sub-object.

**Test fix (`tests/mcp/token-store.test.ts`):** the existing test named
`'setServerAuth overwrites the record for the same server'` set
`codeVerifier` then `tokens` but only asserted the `tokens` field —
it never caught the clobbered `codeVerifier`. Renamed to
`'setServerAuth field-merges into the existing record for the same
server'` and rewrote to assert both fields survive:

```ts
it('setServerAuth field-merges into the existing record for the same server', () => {
  const path = join(tmpdir(), `mcp-tokens-merge-fields-${Date.now()}.json`);
  setServerAuth('a', { codeVerifier: 'v1' }, path);
  setServerAuth(
    'a',
    { tokens: { access_token: 'tok', token_type: 'Bearer' } },
    path,
  );
  const rec = getServerAuth('a', path);
  expect(rec.codeVerifier).toBe('v1');
  expect(rec.tokens?.access_token).toBe('tok');
});
```

**Verified the test actually catches the bug** — ran it against the old
replace-code (`git stash` on just `src/mcp/token-store.ts` to
temporarily revert the fix) before restoring the fix:

```
$ git stash push -- src/mcp/token-store.ts && bun test tests/mcp/token-store.test.ts
...
tests/mcp/token-store.test.ts:
    expect(rec.codeVerifier).toBe('v1');
                              ^
error: expect(received).toBe(expected)

Expected: "v1"
Received: undefined
(fail) token-store > setServerAuth field-merges into the existing record for the same server [0.67ms]

 7 pass
 1 fail
 12 expect() calls
Ran 8 tests across 1 file. [20.00ms]

$ git stash pop   # fix restored
```

**Full contract, with the fix restored:**

```
$ bun test tests/mcp/token-store.test.ts
bun test v1.3.11 (af24e281)

 8 pass
 0 fail
 13 expect() calls
Ran 8 tests across 1 file. [19.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file src/mcp/token-store.ts tests/mcp/token-store.test.ts
$ biome check src/mcp/token-store.ts tests/mcp/token-store.test.ts
Checked 2 files in 4ms. No fixes applied.
```

**Superseded note above:** the "Concerns for downstream tasks" bullet
about `setServerAuth`'s merge being store-level-only (not deep) is now
resolved — the store performs a shallow field-merge per server, so
Task 12/14 callers do NOT need to read-spread-write themselves for the
three top-level keys.
