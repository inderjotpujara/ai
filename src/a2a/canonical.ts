/**
 * Deterministic card canonicalization + hashing (Slice 31, Task 20) — the
 * shared basis for BOTH the expose-side ETag (`card.ts cardEtag`) and the
 * consume-side pin (`client.ts` discover/verifyPin).
 *
 * §7.3 security contract — the hash must be:
 *  - **order-stable**: two cards that differ ONLY in property insertion order
 *    canonicalize to the identical string, so a benign re-serialize by a peer
 *    can never false-trip a pinned hash. Achieved by recursively sorting object
 *    keys before serializing.
 *  - **swap-safe**: moving a value onto a different key MUST change the hash.
 *    JSON serialization keeps key identity (`"k":v` pairs are quoted and
 *    delimited), so a field swap is never collapsed — sorting reorders keys but
 *    never erases which key a value belongs to.
 *  - **array-order-significant**: arrays are recursed but NEVER sorted — the
 *    order of `skills`/`defaultInputModes`/etc. is meaningful, so a reordering
 *    legitimately changes the hash.
 */

import { createHash } from 'node:crypto';
import type { A2aAgentCard } from '../contracts/index.ts';

/** Recursively key-sort objects (arrays kept in order) so serialization is
 *  insensitive to insertion order but faithful to structure + key identity. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Deterministic, key-sorted JSON of the card. */
export function canonicalizeCard(card: A2aAgentCard): string {
  return JSON.stringify(canonicalize(card));
}

/** `sha256` (hex) of the canonical card — the pin value and the ETag. */
export function hashCard(card: A2aAgentCard): string {
  return createHash('sha256').update(canonicalizeCard(card)).digest('hex');
}
