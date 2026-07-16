import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';

const TOKEN = 'a'.repeat(64);
const policy = { port: 0, allowedOrigins: [] as string[] };
const runsRoot = mkdtempSync(join(tmpdir(), 'routes-runs-'));
mkdirSync(join(runsRoot, 'run-1'), { recursive: true });
writeFileSync(
  join(runsRoot, 'run-1', 'spans.jsonl'),
  `${JSON.stringify({ name: 'agent.run', kind: 0, traceId: 't', spanId: 'a', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: { 'agent.outcome': 'answer' }, events: [] })}\n`,
);
const noRun: RunChatTurn = async () => {
  throw new Error('unused');
};
const noCrewRun: RunCrewTurn = async () => {
  throw new Error('unused');
};
const noWorkflowRun: RunWorkflowTurn = async () => {
  throw new Error('unused');
};
const noBuilderRun: RunBuilderTurn = async () => {
  throw new Error('unused');
};
const deps: ServerDeps = {
  token: TOKEN,
  policy,
  recordIo: false,
  indexHtml: '<!doctype html><title>t</title>',
  runChatTurn: noRun,
  consent: createConsentRegistry(),
  uploadsDir: runsRoot,
  runsRoot,
  runCrewTurn: noCrewRun,
  runWorkflowTurn: noWorkflowRun,
  runBuilderTurn: noBuilderRun,
  runModelPull: async () => {},
  freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
};

let server: ReturnType<typeof Bun.serve>;
let base: string;
beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  const { port } = server;
  if (port === undefined) throw new Error('no port');
  policy.port = port;
  base = `http://localhost:${port}`;
});
afterAll(() => server.stop(true));

const auth = { authorization: `Bearer ${TOKEN}` };

test('GET /api/runs requires the token', async () => {
  expect((await fetch(`${base}/api/runs`)).status).toBe(401);
});

test('GET /api/runs lists the run', async () => {
  const res = await fetch(`${base}/api/runs`, { headers: auth });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { id: string }[]; total: number };
  expect(body.items.map((i) => i.id)).toContain('run-1');
});

test('GET /api/runs/:id returns the RunDTO', async () => {
  const res = await fetch(`${base}/api/runs/run-1`, { headers: auth });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { id: string }).id).toBe('run-1');
});

test('GET /api/runs/:id/stream opens an event-stream (not the detail JSON)', async () => {
  const res = await fetch(`${base}/api/runs/run-1/stream`, { headers: auth });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  await res.body?.cancel();
});

test('GET /api/runs/missing → 404', async () => {
  expect(
    (await fetch(`${base}/api/runs/missing`, { headers: auth })).status,
  ).toBe(404);
});
