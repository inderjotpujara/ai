import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { handleCrewRun } from '../../src/server/crews/run.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'crewrun-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function runReq(name: string, body: unknown): Request {
  return new Request(`http://localhost/api/crews/${name}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, invokes the turn detached', async () => {
  const seen: string[] = [];
  const turn: RunCrewTurn = async ({ runId }) => {
    seen.push(runId);
  };
  const res = await handleCrewRun(
    runReq('research-crew', { input: 'AI' }),
    {
      runsRoot: root,
      runCrewTurn: turn,
    },
    'research-crew',
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
  expect(existsSync(join(root, runId))).toBe(true); // dir exists before we streamed
  await new Promise((r) => setTimeout(r, 5)); // let the detached turn run
  expect(seen).toEqual([runId]);
});

test('unknown crew → 404 (no dir created)', async () => {
  const res = await handleCrewRun(
    runReq('nope', { input: 'x' }),
    {
      runsRoot: root,
      runCrewTurn: async () => {},
    },
    'nope',
  );
  expect(res.status).toBe(404);
});

test('malformed body → 400', async () => {
  const res = await handleCrewRun(
    runReq('research-crew', { wrong: 1 }),
    {
      runsRoot: root,
      runCrewTurn: async () => {},
    },
    'research-crew',
  );
  expect(res.status).toBe(400);
});

test('a throwing turn persists error.json (no unhandled rejection)', async () => {
  const turn: RunCrewTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleCrewRun(
    runReq('research-crew', { input: 'AI' }),
    {
      runsRoot: root,
      runCrewTurn: turn,
    },
    'research-crew',
  );
  const { runId } = (await res.json()) as { runId: string };
  await new Promise((r) => setTimeout(r, 10)); // let the .catch write
  expect(existsSync(join(root, runId, 'error.json'))).toBe(true);
});
