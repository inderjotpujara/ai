import { expect, test } from 'bun:test';
import {
  DaemonStatusDtoSchema,
  QueueStatsDtoSchema,
} from '../../src/contracts/dto.ts';

test('DaemonStatusDto round-trips with bind + optional uptime', () => {
  const dto = DaemonStatusDtoSchema.parse({
    running: true,
    pid: 42,
    startedAt: 1000,
    uptimeMs: 500,
    bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
  });
  expect(dto.bind.port).toBe(4130);
  expect(
    DaemonStatusDtoSchema.parse({
      running: false,
      bind: {
        bind: '127.0.0.1',
        allowedHosts: [],
        port: 4130,
        sessionTtlMs: 1,
      },
    }).pid,
  ).toBeUndefined();
});

test('QueueStatsDto keeps activeCount distinct from counts.running', () => {
  const dto = QueueStatsDtoSchema.parse({
    counts: { running: 2 },
    total: 2,
    activeCount: 1,
    concurrency: 4,
  });
  expect(dto.activeCount).toBe(1);
  expect(dto.counts.running).toBe(2);
});
