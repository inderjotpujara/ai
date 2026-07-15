import { expect, test } from 'bun:test';
import type { CrewListResponse } from '../../src/contracts/index.ts';
import { handleCrewDetail } from '../../src/server/crews/detail.ts';
import { handleCrewList } from '../../src/server/crews/list.ts';

test('GET /api/crews lists the registry with COOP header', async () => {
  const res = handleCrewList();
  expect(res.status).toBe(200);
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  const body = (await res.json()) as CrewListResponse;
  expect(body.items.some((i) => i.name === 'research-crew')).toBe(true);
});

test('GET /api/crews/:name returns detail or 404', async () => {
  const ok = handleCrewDetail('research-crew');
  expect(ok.status).toBe(200);
  const missing = handleCrewDetail('no-such-crew');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not found' });
});

test('GET /api/crews/:name — prototype keys 404, not an Object.prototype bypass', () => {
  // A plain `CREWS[name]` returns truthy Object.prototype members for these
  // keys, slipping past the `if (!def)` 404 guard; the Object.hasOwn guard
  // must reject them.
  for (const key of [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
  ]) {
    expect(handleCrewDetail(key).status).toBe(404);
  }
});
