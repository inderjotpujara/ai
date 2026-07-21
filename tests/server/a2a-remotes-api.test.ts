import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoverResult } from '../../src/a2a/client.ts';
import { createRemoteStore } from '../../src/a2a/remotes.ts';
import { A2aRemoteAddRequestSchema } from '../../src/contracts/a2a.ts';
import type { A2aAgentCard } from '../../src/contracts/index.ts';
import {
  handleRemoteAdd,
  handleRemoteDelete,
  handleRemoteList,
} from '../../src/server/a2a/remotes.ts';
import { handleRemoteTest } from '../../src/server/a2a/remotes-test.ts';
import type { SessionGuard } from '../../src/server/security/token.ts';

// --- handler-level harness (mirrors tests/server/a2a-token-api.test.ts) -----

function validCard(url: string): A2aAgentCard {
  return {
    name: 'peer',
    description: 'a remote peer',
    version: '1.0.0',
    protocolVersion: '1.0',
    url,
    preferredTransport: 'JSONRPC',
    skills: [],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: { a2aBearer: { type: 'http', scheme: 'bearer' } },
    security: [{ a2aBearer: [] }],
  };
}

/** A stub client whose `discover` outcome + call count are inspectable —
 *  the tests never hit the network. */
function stubClient(discoverResult?: (cardUrl: string) => DiscoverResult) {
  const calls: string[] = [];
  const impl =
    discoverResult ??
    ((cardUrl: string): DiscoverResult => ({
      ok: true,
      card: validCard(`${cardUrl}-endpoint`),
      pinnedCardHash: `hash-of-${cardUrl}`,
    }));
  return {
    calls,
    client: {
      discover: async (cardUrl: string) => {
        calls.push(cardUrl);
        return impl(cardUrl);
      },
      verifyPin: async () => ({ ok: true as const }),
      invoke: async () => undefined,
    },
  };
}

function ctx(discoverResult?: (cardUrl: string) => DiscoverResult) {
  const dir = mkdtempSync(join(tmpdir(), 'a2a-remotes-api-'));
  const remotes = createRemoteStore({ path: join(dir, 'a2a-remotes.json') });
  const { client, calls } = stubClient(discoverResult);
  return {
    remotes,
    client,
    discoverCalls: calls,
    policy: { port: 4130, allowedOrigins: [] as string[], allowedHosts: [] },
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

function listReq(): Request {
  return new Request('http://127.0.0.1:4130/api/a2a/remotes', {
    method: 'GET',
    headers: { host: '127.0.0.1:4130' },
  });
}
function addReq(body: unknown): Request {
  return new Request('http://127.0.0.1:4130/api/a2a/remotes', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function testReq(body: unknown): Request {
  return new Request('http://127.0.0.1:4130/api/a2a/remotes/test', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function deleteReq(name: string): Request {
  return new Request(`http://127.0.0.1:4130/api/a2a/remotes/${name}`, {
    method: 'DELETE',
    headers: { host: '127.0.0.1:4130' },
  });
}

test('GET /api/a2a/remotes requires trusted-local (403 from a non-loopback principal)', async () => {
  const c = ctx();
  c.remotes.add({
    name: 'peer',
    baseUrl: 'https://peer.ts.net/api/a2a',
    cardUrl: 'https://peer.ts.net/card.json',
    token: 'SECRET',
    pinnedCardHash: 'h',
  });
  const res = handleRemoteList(listReq(), c, remoteGuard);
  expect(res.status).toBe(403);
});

test('GET /api/a2a/remotes never returns the token', async () => {
  const c = ctx();
  c.remotes.add({
    name: 'peer',
    baseUrl: 'https://peer.ts.net/api/a2a',
    cardUrl: 'https://peer.ts.net/card.json',
    token: 'SUPER_SECRET_BEARER',
    pinnedCardHash: 'h',
  });
  const res = handleRemoteList(listReq(), c, localGuard);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    remotes: Array<Record<string, unknown>>;
  };
  expect(body.remotes).toHaveLength(1);
  expect(body.remotes[0]).not.toHaveProperty('token');
  expect(JSON.stringify(body)).not.toContain('SUPER_SECRET_BEARER');
});

test('POST /api/a2a/remotes requires trusted-local: non-loopback → 403, zero side effect, no discover call', async () => {
  const c = ctx();
  const res = await handleRemoteAdd(
    addReq({
      name: 'peer',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 't',
    }),
    c,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(c.remotes.list()).toEqual([]);
  expect(c.discoverCalls).toEqual([]);
});

test('POST /api/a2a/remotes (trusted-local) pins via discover BEFORE persisting', async () => {
  const c = ctx();
  const res = await handleRemoteAdd(
    addReq({
      name: 'peer',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 'SECRET',
    }),
    c,
    localGuard,
  );
  expect(res.status).toBe(201);
  expect(c.discoverCalls).toEqual(['https://peer.ts.net/card.json']);
  const stored = c.remotes.get('peer');
  expect(stored).toBeDefined();
  expect(stored?.token).toBe('SECRET');
  expect(stored?.pinnedCardHash).toBe('hash-of-https://peer.ts.net/card.json');
  // The response DTO omits the token.
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).not.toHaveProperty('token');
});

test('POST /api/a2a/remotes rejects a name with a space (invalid delegate-tool key) — 400, no discover, nothing persisted', async () => {
  const c = ctx();
  const res = await handleRemoteAdd(
    addReq({
      name: 'bad name',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 't',
    }),
    c,
    localGuard,
  );
  expect(res.status).toBe(400);
  // Rejected at the schema edge — no discover call, store untouched.
  expect(c.discoverCalls).toEqual([]);
  expect(c.remotes.list()).toEqual([]);
});

test('POST /api/a2a/remotes rejects a name with a newline (routing-prompt line injection) — 400, no discover, nothing persisted', async () => {
  const c = ctx();
  const res = await handleRemoteAdd(
    addReq({
      name: 'peer\ninjected: line',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 't',
    }),
    c,
    localGuard,
  );
  expect(res.status).toBe(400);
  expect(c.discoverCalls).toEqual([]);
  expect(c.remotes.list()).toEqual([]);
});

test('A2aRemoteAddRequestSchema constrains name to the delegate-tool charset', () => {
  expect(
    A2aRemoteAddRequestSchema.safeParse({
      name: 'ok-Peer_1',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 't',
    }).success,
  ).toBe(true);
  for (const bad of ['has space', 'new\nline', 'dot.name', 'star*', '']) {
    expect(
      A2aRemoteAddRequestSchema.safeParse({
        name: bad,
        cardUrl: 'https://peer.ts.net/card.json',
        token: 't',
      }).success,
    ).toBe(false);
  }
});

test('POST /api/a2a/remotes rejects when discover fails — nothing persisted', async () => {
  const c = ctx(() => ({ ok: false, reason: 'card fetch failed' }));
  const res = await handleRemoteAdd(
    addReq({
      name: 'peer',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 't',
    }),
    c,
    localGuard,
  );
  expect(res.status).toBe(400);
  expect(c.remotes.list()).toEqual([]);
});

test('POST /api/a2a/remotes rejects a card whose advertised url host differs from the pasted cardUrl host (§7.3 SSRF, capstone B4) — 400, nothing persisted', async () => {
  // A hostile peer's card advertises an INTERNAL invoke endpoint (link-local
  // metadata service) even though it was discovered from the operator's host.
  const c = ctx((cardUrl) => ({
    ok: true,
    card: validCard('http://169.254.169.254/latest/meta-data'),
    pinnedCardHash: `hash-of-${cardUrl}`,
  }));
  const res = await handleRemoteAdd(
    addReq({
      name: 'peer',
      cardUrl: 'https://peer.ts.net/card.json',
      token: 't',
    }),
    c,
    localGuard,
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('169.254.169.254');
  // discover ran (the mismatch is caught AFTER discovery), but the hostile
  // endpoint was never persisted.
  expect(c.discoverCalls).toEqual(['https://peer.ts.net/card.json']);
  expect(c.remotes.list()).toEqual([]);
});

test('POST /api/a2a/remotes/test dry-runs discover/validate/pin WITHOUT persisting', async () => {
  const c = ctx();
  const res = await handleRemoteTest(
    testReq({ cardUrl: 'https://peer.ts.net/card.json' }),
    c,
    localGuard,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { card: unknown; pinnedCardHash: string };
  expect(body.pinnedCardHash).toBe('hash-of-https://peer.ts.net/card.json');
  expect(body.card).toBeDefined();
  // The store is byte-for-byte unchanged — nothing persisted by a test call.
  expect(c.remotes.list()).toEqual([]);
});

test('POST /api/a2a/remotes/test requires trusted-local: non-loopback → 403, no discover call', async () => {
  const c = ctx();
  const res = await handleRemoteTest(
    testReq({ cardUrl: 'https://peer.ts.net/card.json' }),
    c,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(c.discoverCalls).toEqual([]);
});

test('DELETE /api/a2a/remotes/:name requires trusted-local, then removes (idempotent)', async () => {
  const c = ctx();
  c.remotes.add({
    name: 'peer',
    baseUrl: 'https://peer.ts.net/api/a2a',
    cardUrl: 'https://peer.ts.net/card.json',
    token: 'SECRET',
    pinnedCardHash: 'h',
  });

  const forbidden = handleRemoteDelete(
    'peer',
    deleteReq('peer'),
    c,
    remoteGuard,
  );
  expect(forbidden.status).toBe(403);
  expect(c.remotes.get('peer')).toBeDefined();

  const ok = handleRemoteDelete('peer', deleteReq('peer'), c, localGuard);
  expect(ok.status).toBe(200);
  expect(c.remotes.get('peer')).toBeUndefined();

  // Idempotent: deleting again is a safe 200 no-op.
  const again = handleRemoteDelete('peer', deleteReq('peer'), c, localGuard);
  expect(again.status).toBe(200);
});
