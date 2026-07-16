import { expect, test } from 'bun:test';
import {
  AgentProposalDtoSchema,
  BuildResultDtoSchema,
  CrewProposalDtoSchema,
  WorkflowProposalDtoSchema,
} from '../../src/contracts/dto.ts';
import { CrewProcess, StepKind } from '../../src/contracts/enums.ts';

test('BuildResultDtoSchema accepts a written agent result carrying its full proposal', () => {
  const r = BuildResultDtoSchema.parse({
    kind: 'written',
    name: 'stock_quotes',
    files: ['agents/stock_quotes.ts'],
    proposal: {
      name: 'stock_quotes',
      description: 'Fetches live stock quotes',
      systemPrompt: 'You fetch quotes.',
      modelReq: {
        role: 'quote fetcher',
        requires: ['tools'],
        prefer: 'largest-that-fits',
      },
      suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
      rationale: 'Needed for the finance workflow.',
    },
  });
  expect(
    r.proposal && 'suggestedServers' in r.proposal
      ? r.proposal.suggestedServers
      : [],
  ).toHaveLength(1);
});

test('BuildResultDtoSchema accepts every other kind with no `proposal` field', () => {
  expect(
    BuildResultDtoSchema.parse({ kind: 'declined' }).proposal,
  ).toBeUndefined();
});

test('AgentProposalDtoSchema accepts a full proposal', () => {
  const p = AgentProposalDtoSchema.parse({
    name: 'stock_quotes',
    description: 'Fetches live stock quotes',
    systemPrompt: 'You fetch quotes.',
    modelReq: {
      role: 'quote fetcher',
      requires: ['tools'],
      prefer: 'largest-that-fits',
    },
    suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
    rationale: 'Needed for the finance workflow.',
  });
  expect(p.name).toBe('stock_quotes');
  expect(p.suggestedServers[0]?.packName).toBe('finance');
});

test('CrewProposalDtoSchema accepts members + tasks with no tools/ZodType', () => {
  const p = CrewProposalDtoSchema.parse({
    id: 'research-crew',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'researcher',
        role: 'Analyst',
        goal: 'gather',
        backstory: 'meticulous',
        requires: ['tools'],
      },
    ],
    tasks: [
      {
        id: 'gather',
        description: 'research',
        expectedOutput: 'facts',
        member: 'researcher',
      },
    ],
  });
  expect(p.members[0]?.name).toBe('researcher');
});

test('WorkflowProposalDtoSchema carries steps with explicit dependsOn', () => {
  const p = WorkflowProposalDtoSchema.parse({
    id: 'fetch-then-summarize',
    steps: [
      { id: 'fetch', kind: StepKind.Tool, tool: 'fetch' },
      {
        id: 'summarize',
        kind: StepKind.Agent,
        agent: 'web_fetch',
        dependsOn: ['fetch'],
      },
    ],
  });
  expect(p.steps[1]?.dependsOn).toEqual(['fetch']);
});
