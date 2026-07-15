import { expect, test } from 'bun:test';
import {
  CrewDetailDtoSchema,
  CrewListItemDtoSchema,
} from '../../src/contracts/dto.ts';
import { CrewProcess } from '../../src/contracts/enums.ts';

test('CrewListItemDtoSchema accepts a minimal summary', () => {
  const item = CrewListItemDtoSchema.parse({
    name: 'research-crew',
    description: 'Research a topic',
    process: CrewProcess.Sequential,
    memberCount: 2,
    taskCount: 2,
  });
  expect(item.name).toBe('research-crew');
});

test('CrewDetailDtoSchema projects members + tasks (no tools/Zod)', () => {
  const detail = CrewDetailDtoSchema.parse({
    name: 'research-crew',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'researcher',
        role: 'Analyst',
        goal: 'gather',
        backstory: 'meticulous',
        requires: ['tools'],
        prefer: 'largest-that-fits',
      },
    ],
    tasks: [
      {
        id: 'gather',
        description: 'research',
        expectedOutput: 'facts',
        member: 'researcher',
        dependsOn: [],
      },
    ],
  });
  expect(detail.members[0]?.name).toBe('researcher');
  expect(detail.tasks[0]?.dependsOn).toEqual([]);
});
