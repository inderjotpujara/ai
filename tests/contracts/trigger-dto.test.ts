import { expect, test } from 'bun:test';
import {
  TriggerDtoSchema,
  TriggerFiringDtoSchema,
} from '../../src/contracts/dto.ts';

test('TriggerDtoSchema round-trips a cron trigger', () => {
  const dto = {
    id: 't-1',
    name: 'nightly',
    type: 'cron',
    enabled: true,
    target: { kind: 'workflow', payload: { input: 'x' } },
    config: { schedule: '0 3 * * *' },
    origin: 'console',
    nextRunAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  expect(TriggerDtoSchema.parse(dto)).toMatchObject({
    id: 't-1',
    type: 'cron',
  });
});

test('TriggerDtoSchema rejects a raw token/secret field', () => {
  expect(
    TriggerDtoSchema.safeParse({
      id: 't-1',
      name: 'nightly',
      type: 'cron',
      enabled: true,
      target: { kind: 'workflow', payload: {} },
      config: {},
      origin: 'console',
      createdAt: 1,
      updatedAt: 1,
      token: 'super-secret',
    }).data,
  ).not.toHaveProperty('token');
});

test('TriggerFiringDtoSchema rejects an unknown outcome', () => {
  expect(() =>
    TriggerFiringDtoSchema.parse({
      id: 'f1',
      triggerId: 't-1',
      firedAt: 1,
      outcome: 'exploded',
    }),
  ).toThrow();
});
