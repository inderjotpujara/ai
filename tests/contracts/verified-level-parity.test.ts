import { expect, test } from 'bun:test';
import { VerifiedLevel as ContractVerifiedLevel } from '../../src/contracts/enums.ts';
import { VerifiedLevel as EngineVerifiedLevel } from '../../src/verified-build/types.ts';

test('contract VerifiedLevel values stay isomorphic with verified-build', () => {
  expect(Object.values(ContractVerifiedLevel).sort()).toEqual(
    Object.values(EngineVerifiedLevel).sort(),
  );
});
