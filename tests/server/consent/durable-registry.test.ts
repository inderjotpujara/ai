import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableConsentRegistry } from '../../../src/server/consent/durable-registry.ts';

const noopEmit = () => {};

test('a pending prompt survives a restart and is still resolvable exactly once', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'consent-')), 'consent.json');
  const r1 = createDurableConsentRegistry({ path });
  // Register a prompt (the awaiting Promise is intentionally left un-awaited).
  void r1.port({ kind: 'tool', question: 'ok?' }, noopEmit);
  const [promptId] = r1.pending();
  expect(promptId).toBeDefined();

  // "Restart": a fresh registry over the SAME store reloads the pending prompt.
  const r2 = createDurableConsentRegistry({ path });
  expect(r2.pending()).toContain(promptId as string);
  expect(r2.resolve(promptId as string, { approved: true })).toBe(true);
  expect(r2.pending()).not.toContain(promptId as string); // settled + persisted
  expect(r2.resolve(promptId as string, { approved: true })).toBe(false); // no double-settle
});
