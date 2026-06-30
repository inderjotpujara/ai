import { afterEach, expect, test } from 'bun:test';
import {
  checkDelegation,
  concise,
  currentDelegationContext,
  returnCapChars,
  runInDelegationContext,
  withRootDelegationContext,
} from '../../src/core/guardrails.ts';

afterEach(() => {
  delete process.env.AGENT_MAX_DELEGATION_DEPTH;
  delete process.env.AGENT_RETURN_CTX_FRACTION;
});

test('checkDelegation allows up to max depth and rejects beyond', async () => {
  expect(checkDelegation('A').ok).toBe(true); // root → depth 1
  // descend to depth 5 (allowed), then a 6th would exceed default max 5
  await runInDelegationContext('A', undefined, () =>
    runInDelegationContext('B', undefined, () =>
      runInDelegationContext('C', undefined, () =>
        runInDelegationContext('D', undefined, async () => {
          // currently depth 4; entering a 5th is ok, a 6th is not
          expect(checkDelegation('E').ok).toBe(true); // would be depth 5
          await runInDelegationContext('E', undefined, async () => {
            const res = checkDelegation('F'); // would be depth 6
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.kind).toBe('depth_exceeded');
          });
        }),
      ),
    ),
  );
});

test('recursion (repeated agent name) is allowed within depth', async () => {
  await runInDelegationContext('A', undefined, async () => {
    expect(checkDelegation('A').ok).toBe(true); // same name again → not rejected
  });
});

test('returnCapChars is live: fraction × num_ctx × 4, with fallback + env override', () => {
  expect(returnCapChars(8192)).toBe(8192); // 0.25 * 8192 * 4
  expect(returnCapChars(undefined)).toBe(4096); // fallback ctx 4096 → 0.25*4096*4
  process.env.AGENT_RETURN_CTX_FRACTION = '0.5';
  expect(returnCapChars(8192)).toBe(16384);
});

test('concise passes short text and truncates long text with a marker', () => {
  expect(concise('short', 8192)).toBe('short');
  const long = 'x'.repeat(9000);
  const out = concise(long, 8192); // cap 8192
  expect(out.startsWith('x'.repeat(8192))).toBe(true);
  expect(out).toContain('…[truncated, 808 chars omitted]');
});

test('delegation context propagates depth/ancestors/numCtx and restores after', async () => {
  const inner = await runInDelegationContext('A', 1000, () =>
    runInDelegationContext('B', 2000, async () => currentDelegationContext()),
  );
  expect(inner).toEqual({ depth: 2, ancestors: ['A', 'B'], numCtx: 2000 });
  expect(currentDelegationContext()).toEqual({ depth: 0, ancestors: [] });
});

test('withRootDelegationContext seeds depth 0 with a budget', async () => {
  const ctx = await withRootDelegationContext(4096, async () =>
    currentDelegationContext(),
  );
  expect(ctx).toEqual({ depth: 0, ancestors: [], numCtx: 4096 });
});
