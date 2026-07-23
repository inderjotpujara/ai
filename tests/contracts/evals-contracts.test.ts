import { expect, test } from 'bun:test';
import { VerifiedLevel } from '../../src/contracts/enums.ts';
import {
  EvalCaseResultDtoSchema,
  EvalHealthDtoSchema,
  EvalHealthListResponseSchema,
  EvalHistoryDtoSchema,
  EvalHistoryListResponseSchema,
  EvalReevalRequestSchema,
  EvalReevalResponseSchema,
} from '../../src/contracts/evals.ts';

const validPerCase = [
  { id: 'case-1', passed: true, detail: 'unanimous yes over 3 judge runs' },
  { id: 'case-2', passed: false, detail: 'judge answered no' },
];

const validHistoryRow = {
  id: 'evh-1',
  artifactId: 'agent:researcher',
  model: 'qwen3.5:4b',
  baselineModel: 'qwen3:4b',
  ts: 1_753_000_000_000,
  passed: true,
  passedCount: 1,
  total: 2,
  regressed: false,
  perCase: validPerCase,
  judgeModel: 'qwen3.5:14b',
  belowBar: false,
  reason: undefined,
};

test('EvalCaseResultDtoSchema parses a valid per-case result', () => {
  const sample = {
    id: 'case-1',
    passed: true,
    detail: 'unanimous yes over 3 judge runs',
  };
  const parsed = EvalCaseResultDtoSchema.parse(sample);
  expect(parsed).toEqual(sample);
});

test('EvalHistoryDtoSchema parses a valid history row and perCase round-trips', () => {
  const parsed = EvalHistoryDtoSchema.parse(validHistoryRow);
  expect(parsed.perCase).toEqual(validPerCase);
  expect(parsed.baselineModel).toBe('qwen3:4b');
});

test('EvalHistoryDtoSchema parses a row missing optional baselineModel/reason', () => {
  const { baselineModel, reason, ...rest } = validHistoryRow;
  const parsed = EvalHistoryDtoSchema.parse(rest);
  expect(parsed.baselineModel).toBeUndefined();
  expect(parsed.reason).toBeUndefined();
});

test('EvalHistoryDtoSchema rejects a malformed row (perCase entry missing detail)', () => {
  expect(() =>
    EvalHistoryDtoSchema.parse({
      ...validHistoryRow,
      perCase: [{ id: 'case-1', passed: true }],
    }),
  ).toThrow();
});

test('EvalHealthDtoSchema parses a rollup with a latest history row', () => {
  const rollup = {
    artifact: 'agent:researcher',
    verifiedLevel: VerifiedLevel.Behaves,
    baselineModel: 'qwen3:4b',
    currentModel: 'qwen3.5:4b',
    latest: validHistoryRow,
    regressed: false,
    thumbsDown: 2,
  };
  const parsed = EvalHealthDtoSchema.parse(rollup);
  expect(parsed.latest?.id).toBe('evh-1');
  expect(parsed.thumbsDown).toBe(2);
});

test('EvalHealthDtoSchema parses a rollup with no latest row yet (never evaluated)', () => {
  const parsed = EvalHealthDtoSchema.parse({
    artifact: 'agent:researcher',
    verifiedLevel: VerifiedLevel.Unverified,
    regressed: false,
    thumbsDown: 0,
  });
  expect(parsed.latest).toBeUndefined();
  expect(parsed.baselineModel).toBeUndefined();
});

test('EvalHealthDtoSchema rejects a malformed rollup (bad verifiedLevel)', () => {
  expect(() =>
    EvalHealthDtoSchema.parse({
      artifact: 'agent:researcher',
      verifiedLevel: 'bogus',
      regressed: false,
      thumbsDown: 0,
    }),
  ).toThrow();
});

test('EvalHealthListResponseSchema / EvalHistoryListResponseSchema parse item arrays', () => {
  const health = EvalHealthListResponseSchema.parse({
    items: [
      {
        artifact: 'agent:researcher',
        verifiedLevel: VerifiedLevel.Runs,
        regressed: false,
        thumbsDown: 0,
      },
    ],
  });
  expect(health.items).toHaveLength(1);

  const history = EvalHistoryListResponseSchema.parse({
    items: [validHistoryRow],
  });
  expect(history.items).toHaveLength(1);
});

test('EvalReevalRequestSchema requires ref when mode=artifact', () => {
  expect(() => EvalReevalRequestSchema.parse({ mode: 'artifact' })).toThrow();
  expect(EvalReevalRequestSchema.parse({ mode: 'all' })).toMatchObject({
    mode: 'all',
  });
  expect(
    EvalReevalRequestSchema.parse({
      mode: 'artifact',
      ref: 'agent:researcher',
    }),
  ).toMatchObject({ mode: 'artifact', ref: 'agent:researcher' });
});

test('EvalReevalResponseSchema parses a valid enqueue result', () => {
  const parsed = EvalReevalResponseSchema.parse({
    enqueued: 2,
    jobIds: ['job-1', 'job-2'],
  });
  expect(parsed.jobIds).toEqual(['job-1', 'job-2']);
});
