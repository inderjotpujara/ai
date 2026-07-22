import { expect, test } from 'bun:test';
import { canonicalizeCard, hashCard } from '../../src/a2a/canonical.ts';
import type { A2aAgentCard } from '../../src/contracts/index.ts';

/** A minimal-but-valid 1.0 card used as the canonicalization fixture. */
function baseCard(): A2aAgentCard {
  return {
    name: 'peer',
    description: 'a remote peer',
    version: '1.0.0',
    protocolVersion: '1.0',
    url: 'https://peer.ts.net/api/a2a',
    preferredTransport: 'JSONRPC',
    skills: [
      { id: 'ask', name: 'Ask', description: 'qa', tags: ['a', 'b'] },
      { id: 'sum', name: 'Sum', description: 'summarize', tags: [] },
    ],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: { a2aBearer: { type: 'http', scheme: 'bearer' } },
    security: [{ a2aBearer: [] }],
  };
}

test('canonicalizeCard is stable under key reordering (no false pin trip)', () => {
  const a = baseCard();
  // Same card, keys inserted in a totally different (nested) order.
  const b: A2aAgentCard = {
    security: [{ a2aBearer: [] }],
    securitySchemes: { a2aBearer: { scheme: 'bearer', type: 'http' } },
    defaultOutputModes: ['text/plain'],
    defaultInputModes: ['text/plain', 'application/json'],
    capabilities: { pushNotifications: false, streaming: true },
    skills: [
      { tags: ['a', 'b'], description: 'qa', name: 'Ask', id: 'ask' },
      { description: 'summarize', tags: [], name: 'Sum', id: 'sum' },
    ],
    url: 'https://peer.ts.net/api/a2a',
    preferredTransport: 'JSONRPC',
    protocolVersion: '1.0',
    version: '1.0.0',
    description: 'a remote peer',
    name: 'peer',
  };
  expect(canonicalizeCard(a)).toBe(canonicalizeCard(b));
  expect(hashCard(a)).toBe(hashCard(b));
});

test('canonicalizeCard is swap-safe: moving a value to a different key changes the hash', () => {
  const a = baseCard();
  const swapped = baseCard();
  // Swap two field VALUES onto each other's keys. Key-sorting alone would be
  // insufficient if serialization dropped key identity — it must not.
  const n = swapped.name;
  swapped.name = swapped.description;
  swapped.description = n;
  expect(hashCard(swapped)).not.toBe(hashCard(a));
});

test('canonicalizeCard treats array ORDER as significant (arrays are not sorted)', () => {
  const a = baseCard();
  const reordered = baseCard();
  reordered.defaultInputModes = ['application/json', 'text/plain'];
  expect(hashCard(reordered)).not.toBe(hashCard(a));
  // ...and a genuine reordering of skills also changes the hash.
  const skillsSwapped = baseCard();
  skillsSwapped.skills = [...baseCard().skills].reverse();
  expect(hashCard(skillsSwapped)).not.toBe(hashCard(a));
});

test('hashCard is a stable 64-hex sha256 of the canonical form', () => {
  const h = hashCard(baseCard());
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(h).toBe(hashCard(baseCard()));
});
