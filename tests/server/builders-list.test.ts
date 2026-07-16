import { expect, test } from 'bun:test';
import type { BuilderRegistryListResponse } from '../../src/contracts/index.ts';
import {
  handleBuilderAgentList,
  handleBuilderCrewList,
} from '../../src/server/builders/list.ts';

test('GET /api/builders/agents lists the agent registry', async () => {
  const res = handleBuilderAgentList();
  expect(res.status).toBe(200);
  const body = (await res.json()) as BuilderRegistryListResponse;
  expect(body.items.some((n) => n === 'file_qa')).toBe(true);
});

test('GET /api/builders/crews lists BOTH the crew and workflow registries', async () => {
  const res = handleBuilderCrewList();
  const body = (await res.json()) as BuilderRegistryListResponse;
  expect(body.items).toContain('research-crew');
  expect(body.items).toContain('fetch-then-summarize');
});
