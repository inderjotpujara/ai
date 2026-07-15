import { expect, test } from 'bun:test';
import { McpAuthKind as ContractMcpAuthKind } from '../../src/contracts/enums.ts';
import { McpAuthKind as EngineMcpAuthKind } from '../../src/mcp/types.ts';

test('contract McpAuthKind values stay isomorphic with the mcp engine', () => {
  expect(Object.values(ContractMcpAuthKind).sort()).toEqual(
    Object.values(EngineMcpAuthKind).sort(),
  );
});
