import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';

const TOKEN = 'a'.repeat(64);
// None of these tests exercise POST /api/upload or an /api/chat body with
// uploadIds, so a plain (never-read) confined dir suffices.
const uploadsDir = mkdtempSync(join(tmpdir(), 'phase4-uploads-'));
// None of these tests exercise a Runs endpoint, so a plain (never-read)
// confined dir suffices here too.
const runsRoot = mkdtempSync(join(tmpdir(), 'phase4-runs-'));
// None of these tests exercise POST /api/chat — a fake that throws if ever
// invoked keeps the fixtures honest about what's actually under test here.
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by these tests');
};

function deps(): ServerDeps {
  return {
    token: TOKEN,
    policy: { port: 0, allowedOrigins: [] as string[] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedRunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir,
    runsRoot,
    runCrewTurn: async () => {},
    runWorkflowTurn: async () => {},
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}

function authPost(path: string, body: unknown): Request {
  return new Request(`http://localhost:0${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Host: 'localhost:0',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('GET /api/crews and /api/workflows route to their handlers', async () => {
  const fetch = buildFetch(deps());
  expect((await fetch(authGet('/api/crews'))).status).toBe(200);
  expect((await fetch(authGet('/api/workflows'))).status).toBe(200);
  expect((await fetch(authGet('/api/crews/research-crew'))).status).toBe(200);
  expect(
    (await fetch(authGet('/api/workflows/fetch-then-summarize'))).status,
  ).toBe(200);
  expect((await fetch(authGet('/api/crews/nope'))).status).toBe(404);
});

test('POST /api/crews/research-crew/run routes to the launch handler', async () => {
  const fetch = buildFetch(deps());
  const res = await fetch(
    authPost('/api/crews/research-crew/run', { input: 'AI' }),
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
});

test('POST /api/workflows/fetch-then-summarize/run routes to the launch handler', async () => {
  const fetch = buildFetch(deps());
  const res = await fetch(
    authPost('/api/workflows/fetch-then-summarize/run', { input: 'AI' }),
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
});
