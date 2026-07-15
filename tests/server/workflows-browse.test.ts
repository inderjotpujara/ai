import { expect, test } from 'bun:test';
import type { WorkflowListResponse } from '../../src/contracts/index.ts';
import { handleWorkflowDetail } from '../../src/server/workflows/detail.ts';
import { handleWorkflowList } from '../../src/server/workflows/list.ts';

test('GET /api/workflows lists the registry', async () => {
  const res = handleWorkflowList();
  expect(res.status).toBe(200);
  const body = (await res.json()) as WorkflowListResponse;
  expect(body.items.some((i) => i.id === 'fetch-then-summarize')).toBe(true);
});

test('GET /api/workflows/:id returns detail with edges, or 404', async () => {
  const ok = handleWorkflowDetail('fetch-then-summarize');
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { edges: unknown[] };
  expect(body.edges.length).toBeGreaterThan(0);
  expect(handleWorkflowDetail('nope').status).toBe(404);
});

test('GET /api/workflows/:id — prototype keys 404, not an Object.prototype bypass', () => {
  for (const key of [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
  ]) {
    expect(handleWorkflowDetail(key).status).toBe(404);
  }
});
