import { expect, test } from 'bun:test';
import {
  AgentCardSchema,
  PartSchema,
  TaskStateWire,
} from '../../src/contracts/a2a.ts';

test('TaskStateWire holds the eight A2A v1.0 wire states', () => {
  expect(Object.values(TaskStateWire).sort() as string[]).toEqual([
    'auth-required',
    'canceled',
    'completed',
    'failed',
    'input-required',
    'rejected',
    'submitted',
    'working',
  ]);
});

test('PartSchema round-trips a text part and rejects an unknown kind', () => {
  expect(PartSchema.parse({ kind: 'text', text: 'hi' })).toMatchObject({
    kind: 'text',
  });
  expect(() => PartSchema.parse({ kind: 'audio', text: 'x' })).toThrow();
});

test('AgentCardSchema rejects a non-1.0 protocolVersion', () => {
  const base = {
    name: 'n',
    description: 'd',
    version: '1',
    protocolVersion: '0.3',
    url: 'https://h/api/a2a',
    skills: [],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: {},
    security: [],
  };
  expect(() => AgentCardSchema.parse(base)).toThrow();
  expect(
    AgentCardSchema.parse({ ...base, protocolVersion: '1.0' }),
  ).toMatchObject({
    protocolVersion: '1.0',
  });
});
