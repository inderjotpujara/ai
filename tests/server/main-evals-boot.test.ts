import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalHealthListResponse } from '../../src/contracts/evals.ts';
import { startWebServer } from '../../src/server/main.ts';

/**
 * Task 21 (Part B) wiring: a real (standalone) `startWebServer` boot must
 * construct the real `evalHistory` store (`createEvalHistoryStore`, sharing
 * the SAME `jobs.db` the queue/trigger stores open — Task 16's
 * `AGENT_QUEUE_PATH` derivation) and thread it onto `ServerDeps`, so
 * `GET /api/evals`/`GET /api/evals/:artifact` stop 503-ing (Task 20 shipped
 * the routes; this closes the carry-forward that left `ServerDeps.evalHistory`
 * unset). This is a thin end-to-end proof over the actual HTTP surface (not
 * the ServerDeps object directly, which isn't exported by the handle) — a 200
 * is only possible if `need(deps.evalHistory, 'evalHistory')` found it
 * populated.
 */
test('a standalone startWebServer boot populates evalHistory so /api/evals returns 200 real data (not 503)', async () => {
  const prevQueue = process.env.AGENT_QUEUE_PATH;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(
    join(tmpdir(), 'evals-boot-queue-'),
  );
  const authDir = mkdtempSync(join(tmpdir(), 'evals-boot-auth-'));
  const handle = startWebServer({
    port: 0,
    rootTokenPath: join(authDir, 'daemon-token'),
    sessionRevocationPath: join(authDir, 'revoked-devices.json'),
  });
  const base = `http://localhost:${handle.port}`;
  try {
    const res = await fetch(`${base}/api/evals`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    // A 503 here would mean `deps.evalHistory` is still unset (the
    // `need()`-guarded pre-wiring shape); 200 proves the real store landed.
    expect(res.status).toBe(200);
    const body = (await res.json()) as EvalHealthListResponse;
    // Real data, not an error fingerprint — `need()` unwired would 503, and
    // this checkout's registry dirs (agents/crews/workflows) carry no
    // `.generated.json` manifest today, so an empty (but real, 200) rollup
    // is the expected shape rather than a fixed fixture count.
    expect(Array.isArray(body.items)).toBe(true);
  } finally {
    await handle.pool.stop();
    handle.server.stop(true);
    handle.jobStore.close();
    if (prevQueue === undefined) delete process.env.AGENT_QUEUE_PATH;
    else process.env.AGENT_QUEUE_PATH = prevQueue;
  }
});
