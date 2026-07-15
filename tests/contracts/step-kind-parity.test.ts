import { expect, test } from 'bun:test';
import { StepKind as ContractStepKind } from '../../src/contracts/enums.ts';
import { StepKind as EngineStepKind } from '../../src/workflow/types.ts';

test('contract StepKind values stay isomorphic with the workflow engine', () => {
  expect(Object.values(ContractStepKind).sort()).toEqual(
    Object.values(EngineStepKind).sort(),
  );
});
