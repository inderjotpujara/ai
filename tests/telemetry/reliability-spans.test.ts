import { describe, expect, it } from 'bun:test';
import { DegradeKind } from '../../src/reliability/ledger.ts';
import { ATTR, recordDegrade } from '../../src/telemetry/spans.ts';

describe('reliability telemetry', () => {
  it('exposes reliability ATTR keys', () => {
    expect(ATTR.RELIABILITY_DEGRADE_REASON).toBe('degrade.reason');
    expect(ATTR.RELIABILITY_DROPPED_AGENT).toBe(
      'partial_failure.dropped_agent',
    );
    expect(ATTR.ERROR_TYPE).toBe('error.type');
  });
  it('recordDegrade does not throw without an active span', () => {
    expect(() =>
      recordDegrade({
        kind: DegradeKind.AgentDropped,
        subject: 'a',
        reason: 'down',
      }),
    ).not.toThrow();
  });
});
