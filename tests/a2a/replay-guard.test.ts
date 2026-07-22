import { expect, test } from 'bun:test';
import { createReplayGuard } from '../../src/a2a/replay-guard.ts';

// The replay guard is the §7.2 anti-replay primitive fronting POST /api/a2a: a
// request must carry a FRESH timestamp (within ±window) and a nonce not seen
// inside that window, or it is rejected before dispatch.

test('replay guard rejects a stale timestamp (409) and a repeated nonce (409)', () => {
  const clock = 1_000_000;
  const guard = createReplayGuard(60_000, () => clock);

  // A fresh nonce with a current timestamp passes.
  expect(guard.check('n1', clock)).toEqual({ ok: true });

  // A timestamp older than the window → 409 (too far in the past).
  expect(guard.check('n2', clock - 61_000)).toEqual({ ok: false, status: 409 });
  // A timestamp beyond +window (clock skew / forgery) → 409.
  expect(guard.check('n3', clock + 61_000)).toEqual({ ok: false, status: 409 });

  // The SAME nonce again, still within the window → replay → 409.
  expect(guard.check('n1', clock)).toEqual({ ok: false, status: 409 });
});

test('a nonce is accepted again once the window has fully passed (LRU eviction)', () => {
  let clock = 0;
  const guard = createReplayGuard(1_000, () => clock);

  expect(guard.check('x', clock)).toEqual({ ok: true });
  // Still inside the window → replay rejected (and NOT re-stamped).
  clock = 500;
  expect(guard.check('x', clock)).toEqual({ ok: false, status: 409 });
  // Past the window → the stale nonce is evicted, so the same value is fresh.
  clock = 3_000;
  expect(guard.check('x', clock)).toEqual({ ok: true });
});

test('a missing/empty nonce or a non-finite timestamp → 401', () => {
  const guard = createReplayGuard(1_000, () => 0);
  expect(guard.check('', 0)).toEqual({ ok: false, status: 401 });
  expect(guard.check('n', Number.NaN)).toEqual({ ok: false, status: 401 });
});

test('the seen-nonce set is bounded (LRU) and never grows without limit', () => {
  const clock = 0;
  const guard = createReplayGuard(1_000_000, () => clock);
  // Insert far more distinct nonces than the cap; the guard must still answer
  // in O(1)-ish memory and keep rejecting a just-seen nonce.
  for (let i = 0; i < 100_000; i++) {
    expect(guard.check(`nonce-${i}`, clock)).toEqual({ ok: true });
  }
  // The most-recent nonce is still remembered → replay rejected.
  expect(guard.check('nonce-99999', clock)).toEqual({ ok: false, status: 409 });
});

test('the seen-nonce hard cap is a config knob (env-fallback), and exceeding it evicts the OLDEST nonce', () => {
  const clock = 0;
  // Cap injected at 3 (the knob is env-fallback in production, overridable here
  // so the eviction is testable without a giant loop). Window huge so nothing
  // ages out on time — only the cap can evict.
  const guard = createReplayGuard(1_000_000, () => clock, 3);
  expect(guard.check('a', clock)).toEqual({ ok: true });
  expect(guard.check('b', clock)).toEqual({ ok: true });
  expect(guard.check('c', clock)).toEqual({ ok: true });
  // A 4th distinct nonce crosses the cap → the OLDEST ('a') is evicted.
  expect(guard.check('d', clock)).toEqual({ ok: true });
  // 'a' was evicted → it is now accepted again (no longer remembered).
  expect(guard.check('a', clock)).toEqual({ ok: true });
  // 'd' (most recent) is still remembered → replay rejected.
  expect(guard.check('d', clock)).toEqual({ ok: false, status: 409 });
});
