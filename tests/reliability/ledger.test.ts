import { describe, expect, it } from 'bun:test';
import {
  createLedger,
  DegradeKind,
  formatLedger,
  serializeLedger,
} from '../../src/reliability/ledger.ts';

describe('DegradationLedger', () => {
  it('records events in order', () => {
    const l = createLedger();
    l.record({
      kind: DegradeKind.AgentDropped,
      subject: 'pdf_agent',
      reason: 'mcp server down',
    });
    l.record({
      kind: DegradeKind.ModelDegraded,
      subject: 'writer',
      reason: 'runtime unreachable',
      detail: 'mlx→ollama',
    });
    expect(l.events).toHaveLength(2);
    expect(l.events[0]?.subject).toBe('pdf_agent');
  });

  it('formatLedger returns empty string with no events', () => {
    expect(formatLedger(createLedger())).toBe('');
  });

  it('formatLedger summarizes events for the user', () => {
    const l = createLedger();
    l.record({
      kind: DegradeKind.AgentDropped,
      subject: 'pdf_agent',
      reason: 'mcp server down',
    });
    const out = formatLedger(l);
    expect(out).toContain('pdf_agent');
    expect(out).toContain('mcp server down');
  });

  it('serializeLedger emits one JSON object per line', () => {
    const l = createLedger();
    l.record({
      kind: DegradeKind.Retried,
      subject: 'download',
      reason: 'ECONNRESET',
    });
    const lines = serializeLedger(l).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '').subject).toBe('download');
  });
});
