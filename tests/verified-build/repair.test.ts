import { describe, expect, test } from 'bun:test';
import { maxRepairs } from '../../src/verified-build/config.ts';
import { repairLoop } from '../../src/verified-build/repair.ts';
import type { DryRunResult } from '../../src/verified-build/types.ts';

const ok: DryRunResult = { ran: true, output: 'ok', repairs: 0 };
const fail = (error: string): DryRunResult => ({
  ran: false,
  error,
  repairs: 0,
});

describe('repairLoop', () => {
  test('fail once then succeed counts one repair', async () => {
    let calls = 0;
    const feedbacks: (string | undefined)[] = [];
    const res = await repairLoop(async (feedback) => {
      feedbacks.push(feedback);
      calls++;
      return calls === 1 ? fail('first boom') : ok;
    });
    expect(res.ran).toBe(true);
    expect(res.repairs).toBe(1);
    expect(feedbacks).toEqual([undefined, 'first boom']);
  });

  test('always-fails stops at maxRepairs', async () => {
    let calls = 0;
    const res = await repairLoop(async () => {
      calls++;
      return fail(`boom ${calls}`);
    });
    expect(res.ran).toBe(false);
    expect(res.repairs).toBe(maxRepairs());
    expect(maxRepairs()).toBe(2);
    expect(calls).toBe(maxRepairs() + 1);
    expect(res.error).toBe('boom 3');
  });

  test('first-try success needs no repairs', async () => {
    const res = await repairLoop(async () => ok);
    expect(res).toEqual({ ran: true, output: 'ok', repairs: 0 });
  });
});
