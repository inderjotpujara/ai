import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { DegradeKind } from '../../src/reliability/ledger.ts';
import { ATTR, recordDegrade, withRunSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('reliability telemetry', () => {
  it('exposes reliability ATTR keys', () => {
    expect(ATTR.RELIABILITY_DEGRADE_REASON).toBe('degrade.reason');
    expect(ATTR.RELIABILITY_DROPPED_AGENT).toBe(
      'partial_failure.dropped_agent',
    );
    expect(ATTR.RELIABILITY_RETRY_ATTEMPTS).toBe('retry.attempts');
    expect(ATTR.RELIABILITY_RETRY_LANE).toBe('retry.lane');
    expect(ATTR.RELIABILITY_BREAKER_STATE).toBe('breaker.state');
    expect(ATTR.RELIABILITY_DEGRADE_FROM).toBe('degrade.from');
    expect(ATTR.RELIABILITY_DEGRADE_TO).toBe('degrade.to');
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

  describe('structured attributes on the emitted span event', () => {
    let exporter: InMemorySpanExporter;
    let provider: BasicTracerProvider;
    beforeEach(() => {
      ({ exporter, provider } = registerTestProvider());
    });
    afterEach(async () => {
      await provider.shutdown();
      exporter.reset();
    });

    it('sets degrade.from/degrade.to for a ModelDegraded event', async () => {
      await withRunSpan('run-1', 'task', async () => {
        recordDegrade({
          kind: DegradeKind.ModelDegraded,
          subject: 'writer',
          reason: 'runtime "mlx" unreachable',
          detail: 'mlx→ollama',
          from: 'mlx',
          to: 'ollama',
        });
      });
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.name === 'agent.run');
      const ev = span?.events.find((e) => e.name === 'reliability.degrade');
      expect(ev).toBeDefined();
      expect(ev?.attributes?.[ATTR.RELIABILITY_DEGRADE_FROM]).toBe('mlx');
      expect(ev?.attributes?.[ATTR.RELIABILITY_DEGRADE_TO]).toBe('ollama');
    });

    it('sets retry.attempts and retry.lane for a Retried event', async () => {
      await withRunSpan('run-2', 'task', async () => {
        recordDegrade({
          kind: DegradeKind.Retried,
          subject: 'tool:flaky',
          reason: 'retry attempt 2',
          detail: 'step=s1',
          attempts: 2,
          lane: 'Transient',
        });
      });
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.name === 'agent.run');
      const ev = span?.events.find((e) => e.name === 'reliability.degrade');
      expect(ev?.attributes?.[ATTR.RELIABILITY_RETRY_ATTEMPTS]).toBe(2);
      expect(ev?.attributes?.[ATTR.RELIABILITY_RETRY_LANE]).toBe('Transient');
    });

    it('sets partial_failure.dropped_agent for an AgentDropped event', async () => {
      await withRunSpan('run-3', 'task', async () => {
        recordDegrade({
          kind: DegradeKind.AgentDropped,
          subject: 'pdf_agent',
          reason: 'mcp server down',
          detail: 'lane=RouteWorthy',
          lane: 'RouteWorthy',
        });
      });
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.name === 'agent.run');
      const ev = span?.events.find((e) => e.name === 'reliability.degrade');
      expect(ev?.attributes?.[ATTR.RELIABILITY_DROPPED_AGENT]).toBe(
        'pdf_agent',
      );
      expect(ev?.attributes?.[ATTR.RELIABILITY_RETRY_LANE]).toBe('RouteWorthy');
    });

    it('sets breaker.state=Open for a CircuitOpen event', async () => {
      await withRunSpan('run-4', 'task', async () => {
        recordDegrade({
          kind: DegradeKind.CircuitOpen,
          subject: 'pdf_agent',
          reason: 'circuit open',
          detail: 'lane=RouteWorthy',
        });
      });
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.name === 'agent.run');
      const ev = span?.events.find((e) => e.name === 'reliability.degrade');
      expect(ev?.attributes?.[ATTR.RELIABILITY_BREAKER_STATE]).toBe('Open');
    });
  });
});
