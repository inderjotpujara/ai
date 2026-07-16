import { expect, test } from 'bun:test';
import { ReuseKind as ContractReuseKind } from '../../src/contracts/enums.ts';
import { ReuseKind as EngineReuseKind } from '../../src/verified-build/types.ts';

test('contract ReuseKind values stay isomorphic with verified-build', () => {
  expect(Object.values(ContractReuseKind).sort()).toEqual(
    Object.values(EngineReuseKind).sort(),
  );
});
