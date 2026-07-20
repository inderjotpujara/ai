import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunOrigin } from '../../src/contracts/enums.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';

test('enqueue persists origin + chainDepth, defaults are undefined/0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  const store = createJobStore({ path: dir }, {});
  const a = store.enqueue({
    kind: JobKind.Chat,
    payload: {},
    origin: RunOrigin.Schedule,
    chainDepth: 3,
  });
  const b = store.enqueue({ kind: JobKind.Chat, payload: {} });
  expect(store.getJob(a.id)?.origin).toBe(RunOrigin.Schedule);
  expect(store.getJob(a.id)?.chainDepth).toBe(3);
  expect(store.getJob(b.id)?.origin).toBeUndefined();
  expect(store.getJob(b.id)?.chainDepth).toBe(0);
  store.close();
});
