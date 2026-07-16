import { expect, test } from 'bun:test';
import { McpTransportKind as ContractMcpTransportKind } from '../../src/contracts/enums.ts';
import { McpTransportKind as EngineMcpTransportKind } from '../../src/mcp/types.ts';

test('contract McpTransportKind values stay isomorphic with the mcp engine', () => {
  expect(Object.values(ContractMcpTransportKind).sort()).toEqual(
    Object.values(EngineMcpTransportKind).sort(),
  );
});
