import { expect, test } from 'bun:test';
import { CrewProcess as ContractCrewProcess } from '../../src/contracts/enums.ts';
import { CrewProcess as EngineCrewProcess } from '../../src/crew/types.ts';

test('contract CrewProcess values stay isomorphic with the crew engine', () => {
  expect(Object.values(ContractCrewProcess).sort()).toEqual(
    Object.values(EngineCrewProcess).sort(),
  );
});
