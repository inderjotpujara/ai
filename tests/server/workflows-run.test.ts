import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import { handleWorkflowRun } from '../../src/server/workflows/run.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workflowrun-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function runReq(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/workflows/${id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, invokes the turn detached', async () => {
  const seen: string[] = [];
  const turn: RunWorkflowTurn = async ({ runId }) => {
    seen.push(runId);
  };
  const res = await handleWorkflowRun(
    runReq('fetch-then-summarize', { input: 'AI' }),
    { runsRoot: root, runWorkflowTurn: turn },
    'fetch-then-summarize',
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
  expect(existsSync(join(root, runId))).toBe(true); // dir exists before we streamed
  await new Promise((r) => setTimeout(r, 5)); // let the detached turn run
  expect(seen).toEqual([runId]);
});

test('unknown workflow → 404 (no dir created)', async () => {
  const res = await handleWorkflowRun(
    runReq('nope', { input: 'x' }),
    { runsRoot: root, runWorkflowTurn: async () => {} },
    'nope',
  );
  expect(res.status).toBe(404);
});

test('malformed body → 400', async () => {
  const res = await handleWorkflowRun(
    runReq('fetch-then-summarize', { wrong: 1 }),
    { runsRoot: root, runWorkflowTurn: async () => {} },
    'fetch-then-summarize',
  );
  expect(res.status).toBe(400);
});

test('a throwing turn persists error.json (no unhandled rejection)', async () => {
  const turn: RunWorkflowTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleWorkflowRun(
    runReq('fetch-then-summarize', { input: 'AI' }),
    { runsRoot: root, runWorkflowTurn: turn },
    'fetch-then-summarize',
  );
  const { runId } = (await res.json()) as { runId: string };
  await new Promise((r) => setTimeout(r, 10)); // let the .catch write
  expect(existsSync(join(root, runId, 'error.json'))).toBe(true);
});
