import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTriggerSecretStore } from '../../src/triggers/secret-store.ts';

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'trigsec-')), 'trigger-secrets.json');
}

test('mint persists a secret retrievable by its ref (round-trip across a fresh store)', () => {
  const path = tempPath();
  const store = createTriggerSecretStore({ path });
  const { secretRef, hmacSecret } = store.mint();
  expect(secretRef).toMatch(/^[0-9a-f]{18}$/); // randomBytes(9) hex
  expect(hmacSecret).toMatch(/^[0-9a-f]{64}$/); // randomBytes(32) hex
  expect(store.get(secretRef)).toBe(hmacSecret);
  // A fresh store over the SAME file resolves the persisted secret.
  expect(createTriggerSecretStore({ path }).get(secretRef)).toBe(hmacSecret);
});

test('mint yields a distinct ref + secret on each call', () => {
  const store = createTriggerSecretStore({ path: tempPath() });
  const a = store.mint();
  const b = store.mint();
  expect(a.secretRef).not.toBe(b.secretRef);
  expect(a.hmacSecret).not.toBe(b.hmacSecret);
  expect(store.get(a.secretRef)).toBe(a.hmacSecret);
  expect(store.get(b.secretRef)).toBe(b.hmacSecret);
});

test('get returns undefined for an unknown ref (fail-closed lookup)', () => {
  const store = createTriggerSecretStore({ path: tempPath() });
  expect(store.get('nope')).toBeUndefined();
});

test('remove drops the secret and persists the drop; absent ref is a no-op', () => {
  const path = tempPath();
  const store = createTriggerSecretStore({ path });
  const { secretRef } = store.mint();
  store.remove(secretRef);
  expect(store.get(secretRef)).toBeUndefined();
  // A fresh store over the SAME file sees the removal persisted.
  expect(createTriggerSecretStore({ path }).get(secretRef)).toBeUndefined();
  expect(() => store.remove('absent')).not.toThrow();
});

test('persisted secrets file is written 0600 (owner-only)', () => {
  const path = tempPath();
  const store = createTriggerSecretStore({ path });
  store.mint();
  const mode = statSync(path).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('a corrupt secrets file fails closed (throws at construction)', () => {
  const path = tempPath();
  writeFileSync(path, '{ not json');
  expect(() => createTriggerSecretStore({ path })).toThrow();
});

test('a non-object secrets file fails closed (throws at construction)', () => {
  const path = tempPath();
  writeFileSync(path, '["array-not-object"]');
  expect(() => createTriggerSecretStore({ path })).toThrow();
});

test('the file holds exactly {ref: secret} — the only at-rest copy of the secret (§7.1)', () => {
  const path = tempPath();
  const store = createTriggerSecretStore({ path });
  const { secretRef, hmacSecret } = store.mint();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    string
  >;
  expect(parsed).toEqual({ [secretRef]: hmacSecret });
});

test('the store object exposes no serialization surface that could leak the secret', () => {
  // §7.1: mint/get/remove only — no toJSON/inspect/enumerable secret field that
  // a logger or DTO serializer could pick the raw secret up from.
  const store = createTriggerSecretStore({ path: tempPath() });
  store.mint();
  expect(Object.keys(store).sort()).toEqual(['get', 'mint', 'remove']);
  expect(JSON.stringify(store)).toBe('{}');
});
