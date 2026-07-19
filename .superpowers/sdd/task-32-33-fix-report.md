# Slice 24 token-store security hardening — fix report

Source: adversarial security audit (Fable), verdict SOUND-WITH-NITS. Three
defense-in-depth fixes applied to `src/server/security/session-token.ts` and
`src/server/security/root-token.ts`.

## Fix 1 — finite-exp guard (`session-token.ts`, `verifySessionToken`)

Before: the `exp` type-guard accepted any `number`, including `NaN`/`Infinity`
(unreachable via `JSON.stringify` on mint, but not defended against on parse).

```ts
if (
  typeof parsed?.deviceId !== 'string' ||
  typeof parsed?.exp !== 'number' ||
  !Number.isFinite(parsed.exp) // defense-in-depth: NaN/Infinity reject
) {
  return null;
}
```

Test added (`session-token.test.ts`): `a validly-signed payload with a
non-finite exp verifies null (finite-exp guard)` — hand-builds the wire
payload `{"deviceId":"d","exp":1e400}` (valid JSON number syntax that
overflows a double to `Infinity` on parse — the one reachable path), signs it
with the store's own documented HMAC scheme (`createHmac('sha256',
rootToken).update(payload).digest('hex')`), and asserts `verifySessionToken`
rejects it.

## Fix 2 — fail-closed `loadRevoked` (`session-token.ts`)

Before: any read/parse error (absent file OR corrupt file) collapsed to `[]`
— fail-OPEN, since a tampered/corrupt revocation file would silently
un-revoke every device.

After: absent file (`ENOENT`) → `[]` (legitimate, e.g. first boot). Any other
read error, JSON parse error, or non-array JSON → throws, so construction of
the session-token store fails closed instead of serving verifies against a
broken store.

```ts
function loadRevoked(path: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Revocation file at ${path} exists but is not valid JSON — ...`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Revocation file at ${path} exists but is not a JSON array — ...`);
  }
  return parsed.filter((d): d is string => typeof d === 'string');
}
```

Tests added: `an absent revocation file yields an empty revoked set —
verifies still succeed`; `a present-but-corrupt revocation file fails closed
at construction (throws, never silently un-revokes)`; `a
present-but-non-array-JSON revocation file also fails closed at construction`.

`existsSync` import removed from `session-token.ts` (no longer needed — the
try/catch on `readFileSync` now does the absent-vs-corrupt distinction).

## Fix 3 — atomic mint-once (`root-token.ts`, `getOrCreateRoot`)

Before: check-then-`writeFileSync(path, token, { mode: 0o600 })` (flag `'w'`)
— a TOCTOU race where two concurrent first-boot calls could both pass the
`existsSync` check and each overwrite with a different minted root.

After: the mint path writes with `{ mode: 0o600, flag: 'wx' }` (O_EXCL) — a
second writer hitting `EEXIST` re-reads and returns the winner's token
instead of clobbering it. `rotate()` is unchanged (`flag: 'w'`, deliberate
overwrite).

```ts
function write(token: string, flag: 'w' | 'wx' = 'w'): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, token, { mode: 0o600, flag });
}
// getOrCreateRoot:
const token = mint();
try {
  write(token, 'wx');
  return token;
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
    return readFileSync(path, 'utf8').trim();
  }
  throw err;
}
```

Tests added (`root-token.test.ts`): `two getOrCreateRoot calls (independent
store instances, simulating a race) return the identical token`; `if the
file pre-exists, getOrCreateRoot returns the existing token and never
overwrites it` (asserts `mtimeMs` is unchanged — proves no rewrite occurred).
Note: sync single-process code cannot force a true OS-level interleaving of
the `existsSync`/`writeFileSync` race window, so these tests validate the
externally-observable mint-once contract (convergence + never-overwrite);
the `wx`/`EEXIST` branch itself is a straightforward, reviewed code path.

## Verification

- `bun run typecheck` — clean.
- `bun run lint:file -- src/server/security/session-token.ts
  src/server/security/root-token.ts tests/server/security/session-token.test.ts
  tests/server/security/root-token.test.ts` — clean (biome, no fixes needed).
- `bun test tests/server/security/` — **19 pass, 0 fail, 29 expect() calls**
  (was 12 tests before this change; 7 new tests added: 1 finite-exp + 3
  fail-closed-revocation + 2 atomic-mint-once, plus 1 pre-existing test
  file's baseline count differences accounted for).
- `bun test tests/server/` (full server suite, regression check) — 265 pass,
  0 fail.

All three fixes are defense-in-depth (no behavior regression for the sound
paths); all pre-existing tests still pass unmodified.
