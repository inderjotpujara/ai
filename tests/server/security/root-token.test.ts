import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';

const tempPath = () =>
  join(mkdtempSync(join(tmpdir(), 'root-')), 'daemon-token');

test('getOrCreateRoot mints once and is stable across calls (survives "restart")', () => {
  const path = tempPath();
  const a = createRootTokenStore({ path }).getOrCreateRoot();
  const b = createRootTokenStore({ path }).getOrCreateRoot(); // fresh store = "restart"
  expect(a).toBe(b);
  expect(a).toHaveLength(64); // 32 bytes hex
});

test('the token file is chmod 0600', () => {
  const path = tempPath();
  createRootTokenStore({ path }).getOrCreateRoot();
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('rotate changes the root', () => {
  const path = tempPath();
  const store = createRootTokenStore({ path });
  const before = store.getOrCreateRoot();
  const after = store.rotate();
  expect(after).not.toBe(before);
  expect(store.getOrCreateRoot()).toBe(after); // persisted
});

// Fix 3 — atomic mint-once: getOrCreateRoot writes with `{ flag: 'wx' }`
// (O_EXCL) so two concurrent first-boot calls can never mint DIVERGENT roots;
// the loser re-reads and returns the winner's token instead of overwriting
// it. Sync code can't force a true OS-level interleaving, so we simulate the
// race as closely as sync code allows: repeated/independent store instances
// over the same path must always converge on one token, and a pre-existing
// file must never be overwritten by a later call.
test('two getOrCreateRoot calls (independent store instances, simulating a race) return the identical token', () => {
  const path = tempPath();
  const a = createRootTokenStore({ path }).getOrCreateRoot();
  const b = createRootTokenStore({ path }).getOrCreateRoot();
  expect(a).toBe(b);
  expect(a).toHaveLength(64);
});

test('if the file pre-exists, getOrCreateRoot returns the existing token and never overwrites it', () => {
  const path = tempPath();
  const pre = createRootTokenStore({ path }).getOrCreateRoot();
  const before = statSync(path).mtimeMs;

  const got = createRootTokenStore({ path }).getOrCreateRoot();

  expect(got).toBe(pre);
  expect(statSync(path).mtimeMs).toBe(before); // file was never rewritten
});

// Fail-OPEN regression (Slice 25b T19 review): a crash inside a non-atomic
// truncate-then-write could leave an EMPTY `daemon-token`. If getOrCreateRoot
// returned that empty string, it would become the HMAC key — and HMAC with an
// empty key is computable by anyone, so any perimeter-passing caller could forge
// a valid session token. The store must NEVER return `''`: an empty file is
// corrupt and must self-heal by re-minting a fresh, full root.
test('an existing EMPTY token file is treated as corrupt and re-minted (never returns an empty HMAC key)', () => {
  const path = tempPath();
  writeFileSync(path, '', { mode: 0o600 }); // simulate the crash-truncated root

  const root = createRootTokenStore({ path }).getOrCreateRoot();

  expect(root).not.toBe(''); // the fail-OPEN key must never be returned
  expect(root).toHaveLength(64); // freshly minted 32-byte hex
  expect(root).toMatch(/^[0-9a-f]{64}$/);
  // The empty remnant on disk was replaced with the real, non-empty root.
  expect(readFileSync(path, 'utf8').trim()).toBe(root);
  expect(readFileSync(path, 'utf8').trim().length).toBeGreaterThan(0);
});

// A whitespace-only file is just as corrupt as an empty one (`.trim()` → '').
test('a whitespace-only token file also self-heals to a real root', () => {
  const path = tempPath();
  writeFileSync(path, '   \n\t  ', { mode: 0o600 });

  const root = createRootTokenStore({ path }).getOrCreateRoot();

  expect(root).toMatch(/^[0-9a-f]{64}$/);
  expect(readFileSync(path, 'utf8').trim()).toBe(root);
});

// rotate() must write crash-atomically (temp-file + rename), so the on-disk root
// is always a complete value and no orphan `.tmp` is ever left behind.
test('rotate writes a valid 64-hex root atomically, leaving no .tmp behind', () => {
  const path = tempPath();
  const dir = dirname(path);
  const store = createRootTokenStore({ path });

  const before = store.getOrCreateRoot();
  const after = store.rotate();

  expect(after).not.toBe(before);
  const onDisk = readFileSync(path, 'utf8').trim();
  expect(onDisk).toBe(after);
  expect(onDisk).toMatch(/^[0-9a-f]{64}$/); // full, non-empty root

  // The atomic write must not leave a temp file in the token's directory.
  const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  expect(leftovers).toEqual([]);
});
