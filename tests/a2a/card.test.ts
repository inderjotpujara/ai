import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';
import { buildAgentCard, cardEtag } from '../../src/a2a/card.ts';
import { JobKind } from '../../src/queue/types.ts';

test('empty allowlist yields a valid card with skills:[]', () => {
  const al = createA2aAllowlist({
    path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json'),
  });
  const card = buildAgentCard({
    allowlist: al,
    publicBaseUrl: 'https://box.ts.net',
  });
  expect(card.skills).toEqual([]);
  expect(card.protocolVersion).toBe('1.0');
  expect(card.url).toBe('https://box.ts.net/api/a2a');
  expect(card.capabilities.pushNotifications).toBe(false);
});
test('a listed skill surfaces on the card', () => {
  const al = createA2aAllowlist({
    path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json'),
  });
  al.put({
    skillId: 'ask',
    name: 'Ask',
    description: 'qa',
    kind: JobKind.Chat,
    ref: 'file_qa',
  });
  const card = buildAgentCard({
    allowlist: al,
    publicBaseUrl: 'https://box.ts.net',
  });
  expect(card.skills.map((s) => s.id)).toEqual(['ask']);
});

test('cardEtag is stable across two builds of the same allowlist state, and changes when a skill is added', () => {
  const al = createA2aAllowlist({
    path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json'),
  });
  const cardA = buildAgentCard({
    allowlist: al,
    publicBaseUrl: 'https://box.ts.net',
  });
  const cardB = buildAgentCard({
    allowlist: al,
    publicBaseUrl: 'https://box.ts.net',
  });
  expect(cardEtag(cardA)).toBe(cardEtag(cardB));

  al.put({
    skillId: 'ask',
    name: 'Ask',
    description: 'qa',
    kind: JobKind.Chat,
    ref: 'file_qa',
  });
  const cardC = buildAgentCard({
    allowlist: al,
    publicBaseUrl: 'https://box.ts.net',
  });
  expect(cardEtag(cardC)).not.toBe(cardEtag(cardA));
});
