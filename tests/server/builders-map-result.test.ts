import { expect, test } from 'bun:test';
import type { AgentProposal } from '../../src/agent-builder/types.ts';
import type { CrewBuildResult } from '../../src/crew-builder/types.ts';
import {
  toBuildResultDto,
  toCrewBuildResultDto,
} from '../../src/server/builders/map-result.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';

const proposal: AgentProposal = {
  name: 'stock_quotes',
  description: 'fetch quotes',
  systemPrompt: 'x',
  modelReq: { role: 'r', requires: [], prefer: 'largest-that-fits' as never },
  suggestedServers: [],
  rationale: 'why',
};

test('toBuildResultDto flattens every BuildResult variant, carrying the FULL proposal on `written`', () => {
  expect(
    toBuildResultDto({
      kind: 'written',
      proposal,
      files: ['a.ts'],
      level: VerifiedLevel.Runs,
    }),
  ).toEqual({
    kind: 'written',
    name: 'stock_quotes',
    files: ['a.ts'],
    level: VerifiedLevel.Runs,
    proposal,
  });
  expect(toBuildResultDto({ kind: 'declined' })).toEqual({ kind: 'declined' });
  expect(
    toBuildResultDto({
      kind: 'invalid',
      issues: [{ field: 'name', problem: 'taken' }],
    }),
  ).toEqual({ kind: 'invalid', issues: [{ field: 'name', problem: 'taken' }] });
  expect(toBuildResultDto({ kind: 'abandoned', reason: 'timeout' })).toEqual({
    kind: 'abandoned',
    reason: 'timeout',
  });
  expect(
    toBuildResultDto({ kind: 'reused', name: 'existing', similarity: 0.9 }),
  ).toEqual({
    kind: 'reused',
    name: 'existing',
    similarity: 0.9,
  });
  expect(
    toBuildResultDto({
      kind: 'failed-verification',
      stage: 'dry-run',
      detail: 'boom',
    }),
  ).toEqual({ kind: 'failed-verification', stage: 'dry-run', detail: 'boom' });
});

const crewResult: CrewBuildResult = {
  kind: 'written',
  shape: 'crew',
  name: 'research-crew',
  files: ['crews/research-crew.ts'],
  builtAgents: ['researcher'],
  level: VerifiedLevel.Behaves,
};

test('toCrewBuildResultDto flattens a written crew result (no IR carried — engine gap, see plan notes)', () => {
  expect(toCrewBuildResultDto(crewResult)).toEqual({
    kind: 'written',
    name: 'research-crew',
    files: ['crews/research-crew.ts'],
    level: VerifiedLevel.Behaves,
  });
});
