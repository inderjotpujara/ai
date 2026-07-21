import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';
import { createA2aEnrollment } from '../../src/a2a/enroll.ts';
import { handleA2aConfig } from '../../src/server/a2a/config.ts';
import { handleA2aSkillsPut } from '../../src/server/a2a/skills.ts';
import {
  handleA2aTokenIssue,
  handleA2aTokenRevoke,
} from '../../src/server/a2a/token.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';
import type { SessionGuard } from '../../src/server/security/token.ts';

// --- handler-level harness (mirrors tests/server/devices/revoke.test.ts) -----

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'a2a-console-'));
  const rootTokens = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const enrollment = createA2aEnrollment({
    rootTokens,
    registryPath: join(dir, 'a2a-tokens.json'),
  });
  const allowlist = createA2aAllowlist({ path: join(dir, 'allowlist.json') });
  return {
    enrollment,
    allowlist,
    publicBaseUrl: 'http://agent.local',
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

function issueReq(label: string): Request {
  return new Request('http://127.0.0.1:4130/api/a2a/token', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
}
function skillsReq(skills: unknown): Request {
  return new Request('http://127.0.0.1:4130/api/a2a/skills', {
    method: 'PUT',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify({ skills }),
  });
}
function revokeReq(id: string): Request {
  return new Request(`http://127.0.0.1:4130/api/a2a/token/${id}`, {
    method: 'DELETE',
    headers: { host: '127.0.0.1:4130' },
  });
}

test('token issue requires trusted-local (403 from a non-loopback principal, no token minted)', async () => {
  const c = ctx();
  expect(c.enrollment.list()).toEqual([]);
  const res = await handleA2aTokenIssue(issueReq('remote'), c, remoteGuard);
  expect(res.status).toBe(403);
  // ZERO side effect on reject: nothing minted.
  expect(c.enrollment.list()).toEqual([]);
});

test('token issue returns the raw token ONCE; GET /api/a2a/config never returns it', async () => {
  const c = ctx();
  const res = await handleA2aTokenIssue(issueReq('my-laptop'), c, localGuard);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; token: string };
  expect(typeof body.token).toBe('string');
  expect(body.token.length).toBeGreaterThan(0);
  expect(typeof body.id).toBe('string');

  // The config view carries only metadata — never the secret.
  const cfgRes = handleA2aConfig(c);
  expect(cfgRes.status).toBe(200);
  const cfg = (await cfgRes.json()) as {
    tokens: Array<Record<string, unknown>>;
  };
  const entry = cfg.tokens.find((t) => t.id === body.id);
  expect(entry).toBeDefined();
  expect(entry?.label).toBe('my-laptop');
  expect(entry).not.toHaveProperty('token');
  // The raw secret must appear NOWHERE in the serialized config.
  expect(JSON.stringify(cfg)).not.toContain(body.token);
});

test('PUT /api/a2a/skills rejects an entry with an unknown ref (400)', async () => {
  const c = ctx();
  const res = await handleA2aSkillsPut(
    skillsReq([
      {
        skillId: 's1',
        name: 'Nope',
        description: 'not registered',
        kind: 'chat',
        ref: 'this_agent_does_not_exist',
      },
    ]),
    c,
    localGuard,
  );
  expect(res.status).toBe(400);
  // Nothing persisted for the rejected ref.
  expect(c.allowlist.list()).toEqual([]);
});

test('PUT /api/a2a/skills also requires trusted-local (403, nothing persisted)', async () => {
  const c = ctx();
  const res = await handleA2aSkillsPut(
    skillsReq([
      {
        skillId: 's1',
        name: 'x',
        description: 'y',
        kind: 'chat',
        ref: 'anything',
      },
    ]),
    c,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(c.allowlist.list()).toEqual([]);
});

test('DELETE /api/a2a/token/:id revokes (trusted-local)', async () => {
  const c = ctx();
  const { id } = c.enrollment.issue('to-revoke');
  expect(c.enrollment.list().map((t) => t.id)).toContain(id);

  // A non-loopback caller is rejected with ZERO side effect first.
  const forbidden = handleA2aTokenRevoke(id, revokeReq(id), c, remoteGuard);
  expect(forbidden.status).toBe(403);
  expect(c.enrollment.list().map((t) => t.id)).toContain(id);

  // Trusted-local revoke removes it.
  const ok = handleA2aTokenRevoke(id, revokeReq(id), c, localGuard);
  expect(ok.status).toBe(200);
  expect(c.enrollment.list().map((t) => t.id)).not.toContain(id);
});
