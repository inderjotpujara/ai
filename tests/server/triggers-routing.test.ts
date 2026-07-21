import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import type { JobStore } from '../../src/queue/store.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import type { SessionStore } from '../../src/session/store.ts';
import { createTriggerSecretStore } from '../../src/triggers/secret-store.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { makeFakePool } from './_fake-pool.ts';

const TOKEN = 'a'.repeat(64);
const PORT = 4130;
const BASE = `http://127.0.0.1:${PORT}`;

const unusedThrow = (label: string) => async (): Promise<never> => {
  throw new Error(`${label} should not be invoked by these tests`);
};

/** A live trigger engine (real store + secretStore) with a stubbed `fire` that
 *  reports a launched job/run, cast to the engine port like the hooks test. */
function makeTriggers(): ServerDeps['triggers'] {
  const store = createTriggerStore({
    path: mkdtempSync(join(tmpdir(), 'trg-route-')),
  });
  const secretStore = createTriggerSecretStore({
    path: join(mkdtempSync(join(tmpdir(), 'trg-route-secrets-')), 's.json'),
  });
  return {
    store,
    secretStore,
    fire: async () => ({ fired: true, jobId: 'job-1', runId: 'run-1' }),
  } as unknown as ServerDeps['triggers'];
}

/** A full ServerDeps for `buildFetch`. `allowedHosts` admits a tunnel host so a
 *  non-loopback (yet perimeter-allowed) request can reach a handler's own
 *  `requireTrustedLocal` gate. `triggers` is omitted when `withTriggers` is
 *  false to exercise the `need()` 503 degrade. */
function makeDeps(withTriggers = true): ServerDeps {
  const mcpConfigPath = join(mkdtempSync(join(tmpdir(), 'trg-mcp-')), 'm.json');
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));
  return {
    token: TOKEN,
    policy: { port: PORT, allowedOrigins: [], allowedHosts: ['box.ts.net'] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedThrow('runChatTurn') as unknown as RunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir: mkdtempSync(join(tmpdir(), 'trg-up-')),
    runsRoot: mkdtempSync(join(tmpdir(), 'trg-runs-')),
    runCrewTurn: unusedThrow('runCrewTurn') as unknown as RunCrewTurn,
    runWorkflowTurn: unusedThrow(
      'runWorkflowTurn',
    ) as unknown as RunWorkflowTurn,
    runBuilderTurn: unusedThrow('runBuilderTurn') as unknown as RunBuilderTurn,
    runModelPull: async () => {},
    freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    mountOne: unusedThrow('mountOne') as unknown as ServerDeps['mountOne'],
    memoryStore: {} as unknown as MemoryStore,
    sessionStore: { close: () => {} } as unknown as SessionStore,
    jobStore: {} as unknown as JobStore,
    pool: makeFakePool(),
    publicBaseUrl: BASE,
    triggers: withTriggers ? makeTriggers() : undefined,
  };
}

/** Build a request through the real dispatcher. `host` defaults to loopback
 *  (trusted-local eligible); pass a tunnel host to stay perimeter-allowed but
 *  non-loopback. */
function req(
  method: string,
  path: string,
  body?: unknown,
  host = `127.0.0.1:${PORT}`,
): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      host,
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const cronBody = (name: string) => ({
  name,
  type: 'cron',
  target: { kind: 'chat', payload: { task: 'x' } },
  config: { schedule: '*/5 * * * *' },
});

const webhookBody = (name: string) => ({
  name,
  type: 'webhook',
  target: { kind: 'chat', payload: { task: 'x' } },
  config: { hmac: false },
});

async function createConsoleTrigger(
  fetch: (r: Request) => Promise<Response>,
  name: string,
): Promise<string> {
  const res = await fetch(req('POST', '/api/triggers', cronBody(name)));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { trigger: { id: string } };
  return body.trigger.id;
}

test('GET /api/triggers routes to the list handler', async () => {
  const fetch = buildFetch(makeDeps());
  const res = await fetch(req('GET', '/api/triggers'));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: unknown[] };
  expect(Array.isArray(body.items)).toBe(true);
});

test('POST /api/triggers routes to the create handler (trusted-local)', async () => {
  const fetch = buildFetch(makeDeps());
  const res = await fetch(req('POST', '/api/triggers', cronBody('nightly')));
  expect(res.status).toBe(201);
});

test('GET /api/triggers/:id routes to the detail handler (404 unknown id)', async () => {
  const fetch = buildFetch(makeDeps());
  const res = await fetch(req('GET', '/api/triggers/trig-nope'));
  expect(res.status).toBe(404);
});

test('GET /api/triggers/:id returns the detail DTO for a known id', async () => {
  const fetch = buildFetch(makeDeps());
  const id = await createConsoleTrigger(fetch, 'detail-me');
  const res = await fetch(req('GET', `/api/triggers/${id}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; type: string };
  expect(body.id).toBe(id);
  expect(body.type).toBe('cron');
});

test("GET /api/triggers and /api/triggers/:id populate a webhook trigger's webhookUrl (token-free)", async () => {
  const fetch = buildFetch(makeDeps());
  const createRes = await fetch(
    req('POST', '/api/triggers', webhookBody('inbound')),
  );
  expect(createRes.status).toBe(201);
  const created = (await createRes.json()) as {
    trigger: { id: string };
    webhookToken: string;
  };

  const listRes = await fetch(req('GET', '/api/triggers'));
  const listBody = (await listRes.json()) as {
    items: { id: string; webhookUrl?: string }[];
  };
  const listed = listBody.items.find((i) => i.id === created.trigger.id);
  expect(listed?.webhookUrl).toBe(`${BASE}/hooks`);
  expect(listed?.webhookUrl).not.toContain(created.webhookToken);

  const detailRes = await fetch(
    req('GET', `/api/triggers/${created.trigger.id}`),
  );
  const detailBody = (await detailRes.json()) as { webhookUrl?: string };
  expect(detailBody.webhookUrl).toBe(`${BASE}/hooks`);
  expect(detailBody.webhookUrl).not.toContain(created.webhookToken);
});

test('PATCH /api/triggers/:id routes to the patch handler', async () => {
  const fetch = buildFetch(makeDeps());
  const id = await createConsoleTrigger(fetch, 'patch-me');
  const res = await fetch(
    req('PATCH', `/api/triggers/${id}`, { enabled: false }),
  );
  expect(res.status).toBe(200);
});

test('DELETE /api/triggers/:id routes to the delete handler', async () => {
  const fetch = buildFetch(makeDeps());
  const id = await createConsoleTrigger(fetch, 'delete-me');
  const res = await fetch(req('DELETE', `/api/triggers/${id}`));
  expect(res.status).toBe(200);
});

test('the /firings and /fire action sub-paths match before bare :id', async () => {
  const fetch = buildFetch(makeDeps());
  const id = await createConsoleTrigger(fetch, 'actioned');

  // GET :id/firings hits the firings handler (paginated shape w/ `total`),
  // NOT the bare-:id detail handler (which would carry `type`/`config`).
  const firings = await fetch(req('GET', `/api/triggers/${id}/firings`));
  expect(firings.status).toBe(200);
  const firingsBody = (await firings.json()) as Record<string, unknown>;
  expect(firingsBody).toHaveProperty('total');
  expect(firingsBody).toHaveProperty('items');
  expect(firingsBody).not.toHaveProperty('type');

  // POST :id/fire hits the fire handler (202 + jobId/runId), proving the
  // action sub-path is not swallowed by the bare :id (GET/PATCH/DELETE) block.
  const fire = await fetch(req('POST', `/api/triggers/${id}/fire`));
  expect(fire.status).toBe(202);
  const fireBody = (await fire.json()) as { jobId: string; runId: string };
  expect(fireBody.jobId).toBe('job-1');
  expect(fireBody.runId).toBe('run-1');
});

test('a literal id "fire"/"firings" on the bare :id path hits detail, not the action handlers', async () => {
  const fetch = buildFetch(makeDeps());
  // GET /api/triggers/fire is the bare-:id detail lookup for id "fire" (no such
  // trigger → 404), NOT a mis-parse of the /fire action (which is POST-only).
  const asFire = await fetch(req('GET', '/api/triggers/fire'));
  expect(asFire.status).toBe(404);
  const asFirings = await fetch(req('GET', '/api/triggers/firings'));
  expect(asFirings.status).toBe(404);
});

test('unconfigured triggers engine degrades to 503 via need()', async () => {
  const fetch = buildFetch(makeDeps(false));
  const res = await fetch(req('GET', '/api/triggers'));
  expect(res.status).toBe(503);
});

test('a mutating route rejects a non-trusted-local caller end-to-end (403)', async () => {
  const fetch = buildFetch(makeDeps());
  // Perimeter-allowed tunnel Host, valid bearer — but NOT loopback, so the
  // handler's own requireTrustedLocal gate rejects it through the real
  // dispatcher (not blocked earlier by the perimeter).
  const res = await fetch(
    req('POST', '/api/triggers', cronBody('nope'), 'box.ts.net'),
  );
  expect(res.status).toBe(403);
});
