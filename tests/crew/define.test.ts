import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { defineCrew, effectiveTaskDeps } from '../../src/crew/define.ts';
import {
  type CrewMember,
  CrewProcess,
  type Task,
} from '../../src/crew/types.ts';

const m = (name: string): CrewMember => ({
  name,
  role: `${name} role`,
  goal: 'g',
  backstory: 'b',
  requires: [Capability.Tools],
  prefer: PreferPolicy.LargestThatFits,
});
const t = (id: string, member: string, dependsOn?: string[]): Task => ({
  id,
  description: 'd',
  expectedOutput: 'e',
  member,
  output: z.string(),
  ...(dependsOn ? { dependsOn } : {}),
});

describe('defineCrew', () => {
  it('accepts a valid sequential crew', () => {
    const def = defineCrew({
      id: 'c',
      process: CrewProcess.Sequential,
      members: [m('a'), m('b')],
      tasks: [t('t1', 'a'), t('t2', 'b')],
    });
    expect(def.tasks).toHaveLength(2);
  });

  it('rejects a task assigned to an unknown member', () => {
    expect(() =>
      defineCrew({
        id: 'c',
        process: CrewProcess.Sequential,
        members: [m('a')],
        tasks: [t('t1', 'ghost')],
      }),
    ).toThrow(/unknown member.*ghost/i);
  });

  it('rejects an unknown dependsOn target', () => {
    expect(() =>
      defineCrew({
        id: 'c',
        process: CrewProcess.Sequential,
        members: [m('a')],
        tasks: [t('t1', 'a'), t('t2', 'a', ['nope'])],
      }),
    ).toThrow(/unknown.*nope/i);
  });

  it('rejects duplicate member names and task ids', () => {
    expect(() =>
      defineCrew({
        id: 'c',
        process: CrewProcess.Sequential,
        members: [m('a'), m('a')],
        tasks: [t('t1', 'a')],
      }),
    ).toThrow(/duplicate member/i);
    expect(() =>
      defineCrew({
        id: 'c',
        process: CrewProcess.Sequential,
        members: [m('a')],
        tasks: [t('t1', 'a'), t('t1', 'a')],
      }),
    ).toThrow(/duplicate task/i);
  });

  it('rejects a task dependency cycle', () => {
    expect(() =>
      defineCrew({
        id: 'c',
        process: CrewProcess.Sequential,
        members: [m('a')],
        tasks: [t('t1', 'a', ['t2']), t('t2', 'a', ['t1'])],
      }),
    ).toThrow(/cycle/i);
  });

  it('effectiveTaskDeps defaults to the previous task', () => {
    const tasks = [t('t1', 'a'), t('t2', 'a')];
    const [t0, t1] = tasks;
    if (!t0 || !t1) throw new Error('unreachable');
    expect(effectiveTaskDeps(t0, 0, tasks)).toEqual([]);
    expect(effectiveTaskDeps(t1, 1, tasks)).toEqual(['t1']);
  });
});
