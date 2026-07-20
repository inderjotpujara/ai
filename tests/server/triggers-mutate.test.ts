import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TriggerCreateResponseSchema } from '../../src/contracts/index.ts';
import { JobKind } from '../../src/queue/types.ts';
import type { SessionGuard } from '../../src/server/security/token.ts';
import { handleTriggerCreate } from '../../src/server/triggers/create.ts';
import { handleTriggerDelete } from '../../src/server/triggers/delete.ts';
import { handleTriggerList } from '../../src/server/triggers/list.ts';
import { handleTriggerPatch } from '../../src/server/triggers/patch.ts';
import { createTriggerSecretStore } from '../../src/triggers/secret-store.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { TriggerOrigin, TriggerType } from '../../src/triggers/types.ts';

function deps() {
  const store = createTriggerStore({
    path: mkdtempSync(join(tmpdir(), 'trg-')),
  });
  const secretStore = createTriggerSecretStore({
    path: join(mkdtempSync(join(tmpdir(), 'trg-secrets-')), 'secrets.json'),
  });
  return {
    triggers: { store, secretStore },
    policy: { port: 4130, allowedOrigins: [], allowedHosts: [] },
    publicBaseUrl: 'http://127.0.0.1:4130',
  };
}

const localGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'local',
};
const remoteGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'uuid-remote',
};

function req(
  method: string,
  path: string,
  body?: unknown,
  host = '127.0.0.1:4130',
): Request {
  return new Request(`http://127.0.0.1:4130${path}`, {
    method,
    headers: { host, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const cronBody = (name: string, schedule = '*/5 * * * *') => ({
  name,
  type: 'cron',
  target: { kind: 'chat', payload: { task: 'x' } },
  config: { schedule },
});

const webhookBody = (name: string, hmac = true) => ({
  name,
  type: 'webhook',
  target: { kind: 'chat', payload: { task: 'x' } },
  config: { hmac },
});

const cronInput = (name: string, origin: TriggerOrigin) => ({
  name,
  type: TriggerType.Cron,
  origin,
  target: { kind: JobKind.Chat, payload: { task: 'x' } },
  config: { schedule: '*/5 * * * *' },
  enabled: true,
});

test('create requires trusted-local (403 from a non-loopback principal, zero side effect)', async () => {
  const d = deps();
  const res = await handleTriggerCreate(
    req('POST', '/api/triggers', cronBody('nightly')),
    d as never,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(d.triggers.store.list()).toEqual([]);
});

test('create requires trusted-local (403 for a non-loopback Host, zero side effect)', async () => {
  const d = deps();
  const res = await handleTriggerCreate(
    req('POST', '/api/triggers', cronBody('nightly'), 'box.ts.net'),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(403);
  expect(d.triggers.store.list()).toEqual([]);
});

test('create a webhook trigger returns the token ONCE + a /hooks URL', async () => {
  const d = deps();
  const res = await handleTriggerCreate(
    req('POST', '/api/triggers', webhookBody('inbound')),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(201);
  const body = TriggerCreateResponseSchema.parse(await res.json());
  expect(body.webhookToken).toBeDefined();
  expect(body.webhookToken?.length).toBeGreaterThan(10);
  expect(body.webhookUrl).toBe(`${d.publicBaseUrl}/hooks/${body.webhookToken}`);
  expect(body.trigger).not.toHaveProperty('webhookToken');

  // GET list never carries the token, the hash, or the secret.
  const listRes = handleTriggerList({ triggers: d.triggers } as never);
  const listText = await listRes.text();
  expect(listText).not.toContain(body.webhookToken as string);

  // The store persisted only the HASH — never the raw token.
  const stored = d.triggers.store.get(body.trigger.id);
  expect(JSON.stringify(stored)).not.toContain(body.webhookToken as string);
});

test('create rejects a bad cron pattern with 400', async () => {
  const d = deps();
  const res = await handleTriggerCreate(
    req('POST', '/api/triggers', cronBody('bad', 'not a cron')),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(400);
  expect(d.triggers.store.list()).toEqual([]);
});

test('create rejects a file trigger whose path escapes the watch root', async () => {
  const d = deps();
  const res = await handleTriggerCreate(
    req('POST', '/api/triggers', {
      name: 'escape',
      type: 'file',
      target: { kind: 'chat', payload: { task: 'x' } },
      config: { path: '../../../etc/passwd' },
    }),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(400);
  expect(d.triggers.store.list()).toEqual([]);
});

test('create a second console trigger with a duplicate name → 409 (no side effect)', async () => {
  const d = deps();
  const first = await handleTriggerCreate(
    req('POST', '/api/triggers', webhookBody('nightly')),
    d as never,
    localGuard,
  );
  expect(first.status).toBe(201);
  const firstBody = TriggerCreateResponseSchema.parse(await first.json());
  const secretRefBefore = d.triggers.store.get(firstBody.trigger.id)?.secretRef;

  const second = await handleTriggerCreate(
    req('POST', '/api/triggers', webhookBody('nightly')),
    d as never,
    localGuard,
  );
  expect(second.status).toBe(409);

  // No second row: the store still holds exactly the first one, untouched.
  const rows = d.triggers.store.list();
  expect(rows.length).toBe(1);
  expect(rows[0]?.id).toBe(firstBody.trigger.id);
  // No second token/secret minted for the rejected duplicate — the surviving
  // row's secretRef is unchanged by the 409 attempt.
  expect(rows[0]?.secretRef).toBe(secretRefBefore);
});

test('patch requires trusted-local (403, zero side effect)', async () => {
  const d = deps();
  const t = d.triggers.store.create(
    cronInput('nightly', TriggerOrigin.Console),
  );
  const res = await handleTriggerPatch(
    t.id,
    req('PATCH', `/api/triggers/${t.id}`, { enabled: false }),
    d as never,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(d.triggers.store.get(t.id)?.enabled).toBe(true);
});

test('patch a repo trigger: enabled OK, config change 403', async () => {
  const d = deps();
  const t = d.triggers.store.create(cronInput('repo-job', TriggerOrigin.Repo));

  const enableRes = await handleTriggerPatch(
    t.id,
    req('PATCH', `/api/triggers/${t.id}`, { enabled: false }),
    d as never,
    localGuard,
  );
  expect(enableRes.status).toBe(200);
  expect(d.triggers.store.get(t.id)?.enabled).toBe(false);

  const configRes = await handleTriggerPatch(
    t.id,
    req('PATCH', `/api/triggers/${t.id}`, {
      config: { schedule: '*/1 * * * *' },
    }),
    d as never,
    localGuard,
  );
  expect(configRes.status).toBe(403);
  // The definition is untouched by the rejected edit.
  expect(d.triggers.store.get(t.id)?.config).toEqual({
    schedule: '*/5 * * * *',
  });
});

test('patch a console trigger: config change is applied + nextRunAt recomputed', async () => {
  const d = deps();
  const t = d.triggers.store.create(
    cronInput('console-job', TriggerOrigin.Console),
  );
  const res = await handleTriggerPatch(
    t.id,
    req('PATCH', `/api/triggers/${t.id}`, {
      config: { schedule: '*/1 * * * *' },
    }),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(200);
  const updated = d.triggers.store.get(t.id);
  expect(updated?.config).toEqual({ schedule: '*/1 * * * *' });
  expect(updated?.nextRunAt).toBeDefined();
});

test('patch rejects a bad cron config with 400', async () => {
  const d = deps();
  const t = d.triggers.store.create(
    cronInput('console-job', TriggerOrigin.Console),
  );
  const res = await handleTriggerPatch(
    t.id,
    req('PATCH', `/api/triggers/${t.id}`, { config: { schedule: 'nope' } }),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(400);
});

test('patch → 404 for an unknown id', async () => {
  const d = deps();
  const res = await handleTriggerPatch(
    'trig-nope',
    req('PATCH', '/api/triggers/trig-nope', { enabled: false }),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(404);
});

test('delete requires trusted-local (403, zero side effect)', async () => {
  const d = deps();
  const t = d.triggers.store.create(
    cronInput('nightly', TriggerOrigin.Console),
  );
  const res = handleTriggerDelete(
    t.id,
    req('DELETE', `/api/triggers/${t.id}`),
    d as never,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(d.triggers.store.get(t.id)).toBeDefined();
});

test('delete a repo trigger → 403; delete a console trigger → 200 + secret removed', async () => {
  const d = deps();
  const repoTrigger = d.triggers.store.create(
    cronInput('repo-job', TriggerOrigin.Repo),
  );
  const repoRes = handleTriggerDelete(
    repoTrigger.id,
    req('DELETE', `/api/triggers/${repoTrigger.id}`),
    d as never,
    localGuard,
  );
  expect(repoRes.status).toBe(403);
  expect(d.triggers.store.get(repoTrigger.id)).toBeDefined();

  const createRes = await handleTriggerCreate(
    req('POST', '/api/triggers', webhookBody('inbound')),
    d as never,
    localGuard,
  );
  const created = TriggerCreateResponseSchema.parse(await createRes.json());
  const stored = d.triggers.store.get(created.trigger.id);
  const secretRef = stored?.secretRef;
  expect(secretRef).toBeDefined();
  expect(d.triggers.secretStore.get(secretRef as string)).toBeDefined();

  const deleteRes = handleTriggerDelete(
    created.trigger.id,
    req('DELETE', `/api/triggers/${created.trigger.id}`),
    d as never,
    localGuard,
  );
  expect(deleteRes.status).toBe(200);
  expect(d.triggers.store.get(created.trigger.id)).toBeUndefined();
  expect(d.triggers.secretStore.get(secretRef as string)).toBeUndefined();
});

test('delete → 404 for an unknown id', () => {
  const d = deps();
  const res = handleTriggerDelete(
    'trig-nope',
    req('DELETE', '/api/triggers/trig-nope'),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(404);
});
