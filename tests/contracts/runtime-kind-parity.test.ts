import { expect, test } from 'bun:test';
import { RuntimeKind as ContractRuntimeKind } from '../../src/contracts/enums.ts';
import { RuntimeKind as CoreRuntimeKind } from '../../src/core/types.ts';

test('contract RuntimeKind values stay isomorphic with core', () => {
  expect(Object.values(ContractRuntimeKind).sort()).toEqual(
    Object.values(CoreRuntimeKind).sort(),
  );
});
