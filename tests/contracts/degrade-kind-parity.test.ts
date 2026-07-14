import { expect, test } from 'bun:test';
import { DegradeKind as ContractDegradeKind } from '../../src/contracts/enums.ts';
import { DegradeKind as LedgerDegradeKind } from '../../src/reliability/ledger.ts';

test('contract DegradeKind values stay isomorphic with the reliability ledger', () => {
  const contract = Object.values(ContractDegradeKind).sort();
  const ledger = Object.values(LedgerDegradeKind).sort();
  expect(contract).toEqual(ledger);
});
