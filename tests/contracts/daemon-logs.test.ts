import { expect, test } from 'bun:test';
import {
  DaemonLogsQuerySchema,
  DaemonLogsResponseSchema,
} from '../../src/contracts/requests.ts';

test('DaemonLogsQuery coerces tail, applies defaults, caps at 2000', () => {
  expect(DaemonLogsQuerySchema.parse({}).tail).toBe(200);
  expect(DaemonLogsQuerySchema.parse({}).stream).toBe('out');
  expect(DaemonLogsQuerySchema.parse({ tail: '50' }).tail).toBe(50);
  expect(() => DaemonLogsQuerySchema.parse({ tail: '3000' })).toThrow();
  expect(() => DaemonLogsQuerySchema.parse({ stream: 'both' })).toThrow();
});

test('DaemonLogsQuery accepts an explicit stream value', () => {
  expect(DaemonLogsQuerySchema.parse({ stream: 'err' }).stream).toBe('err');
});

test('DaemonLogsResponse round-trips a lines array', () => {
  const parsed = DaemonLogsResponseSchema.parse({ lines: ['a', 'b'] });
  expect(parsed.lines).toEqual(['a', 'b']);
});
