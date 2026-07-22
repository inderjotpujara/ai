import { expect, test } from 'bun:test';
import { resolveSkillId } from '../../src/a2a/client.ts';
import type { A2aAgentCard, A2aAgentSkill } from '../../src/contracts/index.ts';

function skill(id: string): A2aAgentSkill {
  return { id, name: id, description: `the ${id} skill`, tags: [] };
}

function card(skills: A2aAgentSkill[]): A2aAgentCard {
  return {
    name: 'peer',
    description: 'a remote peer',
    version: '1.0.0',
    protocolVersion: '1.0',
    url: 'https://peer.ts.net/api/a2a',
    preferredTransport: 'JSONRPC',
    skills,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: {},
    security: [],
  };
}

test('sole-skill card auto-picks that skill id (no explicit needed)', () => {
  expect(resolveSkillId(card([skill('only-skill')]))).toBe('only-skill');
});

test('explicit skillId present in the card is used verbatim', () => {
  expect(resolveSkillId(card([skill('a'), skill('b'), skill('c')]), 'b')).toBe(
    'b',
  );
});

test('explicit skillId absent from the card is a fail-closed error listing available ids', () => {
  expect(() => resolveSkillId(card([skill('a'), skill('b')]), 'nope')).toThrow(
    /nope/,
  );
  // The error surfaces the available ids so the operator can pick one.
  try {
    resolveSkillId(card([skill('a'), skill('b')]), 'nope');
  } catch (err) {
    expect((err as Error).message).toContain('a');
    expect((err as Error).message).toContain('b');
  }
});

test('multi-skill card with no explicit choice is a fail-closed error listing ids (never guesses)', () => {
  expect(() => resolveSkillId(card([skill('one'), skill('two')]))).toThrow();
  try {
    resolveSkillId(card([skill('one'), skill('two')]));
  } catch (err) {
    expect((err as Error).message).toContain('one');
    expect((err as Error).message).toContain('two');
  }
});

test('zero-skill card is a fail-closed error (nothing to delegate to)', () => {
  expect(() => resolveSkillId(card([]))).toThrow();
});

test('an empty-string explicit skillId is treated as absent (falls back to the rule, not a match)', () => {
  // sole skill → auto-pick despite the empty explicit
  expect(resolveSkillId(card([skill('solo')]), '')).toBe('solo');
  // multi with empty explicit → still ambiguous → error
  expect(() => resolveSkillId(card([skill('a'), skill('b')]), '')).toThrow();
});

test('a sole/chosen skill id over the 128-char cap throws (review minor 2)', () => {
  const tooLong = 'x'.repeat(129);
  expect(() => resolveSkillId(card([skill(tooLong)]))).toThrow(/128/);
});

test('a sole/chosen skill id at exactly the 128-char cap is ok', () => {
  const atCap = 'x'.repeat(128);
  expect(resolveSkillId(card([skill(atCap)]))).toBe(atCap);
});
