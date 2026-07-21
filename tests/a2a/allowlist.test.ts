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

test('put rejects a non-exposable kind even with a registered ref (Pull, §7.4)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(() =>
    al.put({
      skillId: 'p',
      name: 'P',
      description: '',
      kind: JobKind.Pull, // Pull is not a Chat|Crew|Workflow exposure surface
      ref: 'file_qa', // even though file_qa is a registered agent
    }),
  ).toThrow();
});

test('resolve re-validates the ref: an unregistered ref resolves to undefined', () => {
  const path = p();
  // Hand-edited store: valid SHAPE, but ref names no registered target.
  writeFileSync(
    path,
    JSON.stringify({
      skills: [
        {
          skillId: 'stale',
          name: 'Stale',
          description: '',
          kind: JobKind.Chat,
          ref: 'deleted_agent_xyz',
        },
      ],
    }),
  );
  const al = createA2aAllowlist({ path });
  expect(al.resolve('stale')).toBeUndefined();
});

test('load drops an entry with a kind that is not a valid JobKind (garbage_kind)', () => {
  const path = p();
  // Hand-edited store: valid string fields, but kind is not a JobKind member.
  writeFileSync(
    path,
    JSON.stringify({
      skills: [
        {
          skillId: 'garbage',
          name: 'Garbage',
          description: '',
          kind: 'garbage_kind',
          ref: 'file_qa',
        },
      ],
    }),
  );
  const al = createA2aAllowlist({ path });
  expect(al.list().map((s) => s.skillId)).toEqual([]);
  expect(al.resolve('garbage')).toBeUndefined();
});
