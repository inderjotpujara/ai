/**
 * Anti-replay guard for the inbound A2A surface (Slice 31, Task 16, §7.2).
 *
 * A verified A2A Bearer alone does not make a request safe to dispatch: a
 * captured-but-valid request could be REPLAYED. The gate on `POST /api/a2a`
 * therefore additionally requires each request to carry a fresh timestamp and a
 * one-shot nonce (`x-a2a-timestamp` / `x-a2a-nonce`). This guard is the state
 * that enforces both, checked AFTER Bearer verification and BEFORE the body is
 * read or dispatched.
 *
 * Two rejections, both `409` (a well-authenticated but non-fresh request — the
 * caller may legitimately retry with a new nonce/timestamp):
 *  - a timestamp outside `±windowMs` of now (too old to still be in flight, or
 *    skewed into the future);
 *  - a nonce already seen inside the window (a replay).
 *
 * A missing/empty nonce or a non-finite timestamp is a malformed request →
 * `401` (it never presented the freshness proof at all).
 *
 * The seen-nonce set is a BOUNDED insertion-ordered LRU: entries older than the
 * window are evicted on each check (they can no longer collide with an in-window
 * timestamp), and a hard cap evicts the oldest so a flood of distinct nonces can
 * never grow memory without limit. No nonce value is ever logged.
 */

import { loadConfig } from '../config/schema.ts';

/** A `check` verdict: pass, or a rejection carrying the HTTP status the route
 *  should return. `401` = malformed freshness proof; `409` = stale/replayed. */
export type ReplayVerdict = { ok: true } | { ok: false; status: 401 | 409 };

export type ReplayGuard = {
  check(nonce: string, tsMs: number): ReplayVerdict;
};

/**
 * Build a replay guard over a fixed window. `now` is injectable (tests drive a
 * deterministic clock); it defaults to `Date.now`. `maxSeenNonces` is the hard
 * ceiling on remembered nonces — a config knob (`AGENT_A2A_MAX_SEEN_NONCES`,
 * env-fallback only, NOT a hardcode) mirroring the window-is-a-knob discipline:
 * well past the count a legitimate peer emits inside one window, a bound purely
 * to cap memory under a distinct-nonce flood. Injectable so the cap-eviction is
 * testable without inserting tens of thousands of nonces.
 */
export function createReplayGuard(
  windowMs: number,
  now: () => number = Date.now,
  maxSeenNonces = Number(loadConfig().values.AGENT_A2A_MAX_SEEN_NONCES),
): ReplayGuard {
  // nonce → the ms timestamp we first accepted it at. A Map preserves insertion
  // order, so the first key is always the oldest — an O(1) LRU eviction.
  const seen = new Map<string, number>();

  return {
    check(nonce, tsMs) {
      // Malformed freshness proof (no nonce, or an unparseable timestamp) never
      // presented the proof at all → 401, not a replay 409.
      if (
        typeof nonce !== 'string' ||
        nonce.length === 0 ||
        !Number.isFinite(tsMs)
      ) {
        return { ok: false, status: 401 };
      }

      const nowMs = now();

      // Outside the window in either direction (too old to still be in flight,
      // or skewed/forged into the future) → stale.
      if (Math.abs(nowMs - tsMs) > windowMs) {
        return { ok: false, status: 409 };
      }

      // Evict every nonce older than the window: it can no longer collide with
      // an in-window timestamp, so keeping it only wastes memory.
      for (const [seenNonce, seenAt] of seen) {
        if (nowMs - seenAt > windowMs) {
          seen.delete(seenNonce);
        } else {
          // Insertion order → the first non-stale entry means the rest are
          // newer; stop scanning.
          break;
        }
      }

      // A nonce still remembered inside the window is a replay (NOT re-stamped —
      // its original acceptance time governs when it finally ages out).
      if (seen.has(nonce)) {
        return { ok: false, status: 409 };
      }

      seen.set(nonce, nowMs);
      // Hard cap: drop the oldest until back under the ceiling.
      while (seen.size > maxSeenNonces) {
        const oldest = seen.keys().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      return { ok: true };
    },
  };
}
