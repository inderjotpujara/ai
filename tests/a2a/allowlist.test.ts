import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';
import { JobKind } from '../../src/queue/types.ts';

const p = () => join(mkdtempSync(join(tmpdir(), 'a2a-')), 'a2a-skills.json');

test('put a valid agent-backed skill; resolve returns its target', () => {
  const al = createA2aAllowlist({ path: p() });
  al.put({
    skillId: 'ask',
    name: 'Ask',
    description: 'qa',
    kind: JobKind.Chat,
    ref: 'file_qa',
  }); // file_qa is a registered agent
  expect(al.resolve('ask')).toEqual({ kind: JobKind.Chat, ref: 'file_qa' });
  expect(al.list().map((s) => s.skillId)).toEqual(['ask']);
});

test('put rejects a skill whose ref is not a registered agent/crew/workflow (§7.4)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(() =>
    al.put({
      skillId: 'x',
      name: 'X',
      description: '',
      kind: JobKind.Crew,
      ref: 'no_such_crew',
    }),
  ).toThrow();
});

test('resolve returns undefined for an unlisted skill (resolve-then-reject)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(al.resolve('ghost')).toBeUndefined();
});

test('load fails closed on a present-but-corrupt store (never returns empty)', () => {
  const path = p();
  writeFileSync(path, '{ this is not valid json');
  expect(() => createA2aAllowlist({ path }).list()).toThrow();
});
