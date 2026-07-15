import { expect, test } from 'bun:test';
import researchCrew from '../../crews/research-crew.ts';
import { mapCrewToDetail, mapCrewToListItem } from '../../src/crew/crew-dto.ts';

test('mapCrewToListItem summarizes counts', () => {
  const item = mapCrewToListItem(researchCrew);
  expect(item.name).toBe('research-crew');
  expect(item.memberCount).toBe(2);
  expect(item.taskCount).toBe(2);
});

test('mapCrewToDetail projects members + tasks, drops tools/Zod, defaults dependsOn to []', () => {
  const detail = mapCrewToDetail(researchCrew);
  expect(detail.members.map((m) => m.name)).toEqual(['researcher', 'writer']);
  // researcher has no agentRef; requires/prefer are stringified enum values
  expect(detail.members[0]?.requires).toEqual(['tools']);
  const gather = detail.tasks.find((t) => t.id === 'gather');
  expect(gather?.dependsOn).toEqual([]); // undefined dependsOn → []
  expect(detail.tasks.find((t) => t.id === 'brief')?.dependsOn).toEqual([
    'gather',
  ]);
});
