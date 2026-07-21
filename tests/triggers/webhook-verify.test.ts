import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  constantTimeEqualHex,
  hashToken,
  verifyHmac,
} from '../../src/triggers/webhook-verify.ts';

const SECRET = 'a'.repeat(64);
const WINDOW = 5 * 60_000;

function sign(ts: string, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

test('hashToken is deterministic sha256 hex, never the raw token', () => {
  const h = hashToken('super-secret-token');
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(h).not.toContain('super-secret-token');
  expect(hashToken('super-secret-token')).toBe(h);
  expect(hashToken('other')).not.toBe(h);
});

test('constantTimeEqualHex: equal digests true, mismatch/length-mismatch false', () => {
  const a = hashToken('x');
  expect(constantTimeEqualHex(a, a)).toBe(true);
  expect(constantTimeEqualHex(a, hashToken('y'))).toBe(false);
  expect(constantTimeEqualHex(a, `${a}00`)).toBe(false);
  expect(constantTimeEqualHex(a, '')).toBe(false);
});

test('verifyHmac accepts a correct signature within the window', () => {
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000)); // SECONDS
  const body = '{"hello":"world"}';
  const r = verifyHmac({
    rawBody: body,
    secret: SECRET,
    signatureHeader: sign(ts, body),
    timestampHeader: ts,
    now,
    windowMs: WINDOW,
  });
  expect(r.ok).toBe(true);
});

test('verifyHmac rejects a bad signature with 401', () => {
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const body = '{"hello":"world"}';
  const r = verifyHmac({
    rawBody: body,
    secret: SECRET,
    signatureHeader: sign(ts, 'a different body'),
    timestampHeader: ts,
    now,
    windowMs: WINDOW,
  });
  expect(r).toEqual({ ok: false, status: 401 });
});

test('verifyHmac rejects a missing signature header with 401', () => {
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const r = verifyHmac({
    rawBody: 'b',
    secret: SECRET,
    signatureHeader: null,
    timestampHeader: ts,
    now,
    windowMs: WINDOW,
  });
  expect(r).toEqual({ ok: false, status: 401 });
});

test('verifyHmac rejects a stale timestamp with 409 (replay window)', () => {
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000) - 600); // 10 min old, window 5 min
  const body = 'b';
  const r = verifyHmac({
    rawBody: body,
    secret: SECRET,
    signatureHeader: sign(ts, body),
    timestampHeader: ts,
    now,
    windowMs: WINDOW,
  });
  expect(r).toEqual({ ok: false, status: 409 });
});

test('verifyHmac rejects an absent/garbage timestamp with 409', () => {
  const now = 1_800_000_000_000;
  const r1 = verifyHmac({
    rawBody: 'b',
    secret: SECRET,
    signatureHeader: 'deadbeef',
    timestampHeader: null,
    now,
    windowMs: WINDOW,
  });
  expect(r1).toEqual({ ok: false, status: 409 });
  const r2 = verifyHmac({
    rawBody: 'b',
    secret: SECRET,
    signatureHeader: 'deadbeef',
    timestampHeader: 'not-a-number',
    now,
    windowMs: WINDOW,
  });
  expect(r2).toEqual({ ok: false, status: 409 });
});

// M4: a client that sends MILLISECONDS instead of seconds is rejected (409),
// not accepted — a ~13-digit value read as seconds lands ~thousands of years
// in the future, far outside the window.
test('verifyHmac rejects a millisecond-unit timestamp with 409 (wrong unit)', () => {
  const now = 1_800_000_000_000;
  const ts = String(now); // MILLISECONDS (~13 digits)
  const body = 'b';
  const r = verifyHmac({
    rawBody: body,
    secret: SECRET,
    signatureHeader: sign(ts, body),
    timestampHeader: ts,
    now,
    windowMs: WINDOW,
  });
  expect(r).toEqual({ ok: false, status: 409 });
});

// The replay check must short-circuit BEFORE the signature compare — a stale
// but otherwise correctly-signed request is 409, never 401 or ok.
test('verifyHmac checks replay window BEFORE the signature', () => {
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000) - 600);
  const r = verifyHmac({
    rawBody: 'b',
    secret: SECRET,
    signatureHeader: 'not-even-close', // would be 401 if checked first
    timestampHeader: ts,
    now,
    windowMs: WINDOW,
  });
  expect(r).toEqual({ ok: false, status: 409 });
});
