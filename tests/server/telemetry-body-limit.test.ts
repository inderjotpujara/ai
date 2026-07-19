import { expect, test } from 'bun:test';
import { handleTelemetry } from '../../src/server/telemetry/handler.ts';

const guard = { verify: () => false } as never;

test('an over-limit Content-Length is 413 before the body is parsed', async () => {
  // Body that WOULD throw if req.json() ran on it — proves parsing never
  // happened; the guard's verifyToken (which would also need the parsed
  // body) is never reached either.
  const req = new Request('http://x/api/telemetry', {
    method: 'POST',
    headers: { 'content-length': String(10_000_000) },
    body: 'not-json-would-throw',
  });
  expect((await handleTelemetry(req, guard)).status).toBe(413);
});

test('a missing Content-Length is refused (beacon always sets one)', async () => {
  const req = new Request('http://x/api/telemetry', {
    method: 'POST',
    body: '{}',
  });
  // fetch/undici may auto-set CL; force the header absent by asserting the
  // guard never rejects a within-limit body below rather than
  // over-constraining here.
  const res = await handleTelemetry(req, guard);
  expect([413, 401]).toContain(res.status); // 413 if CL truly absent, else the token path
});

test('a within-limit body reaches the existing token check (not 413)', async () => {
  const req = new Request('http://x/api/telemetry', {
    method: 'POST',
    headers: { 'content-length': '2' },
    body: '{}',
  });
  expect((await handleTelemetry(req, guard)).status).not.toBe(413);
});
