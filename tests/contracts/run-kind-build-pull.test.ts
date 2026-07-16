import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';

test('RunKind gains Build/Pull members (Slice 30b Phase 5)', () => {
  expect(RunKind.Build as string).toBe('build');
  expect(RunKind.Pull as string).toBe('pull');
});

test('RunKind gains Mcp/Memory members (Slice 30b Phase 5 final review)', () => {
  expect(RunKind.Mcp as string).toBe('mcp');
  expect(RunKind.Memory as string).toBe('memory');
  expect((Object.values(RunKind) as string[]).sort()).toEqual(
    [
      'agent',
      'build',
      'chat',
      'crew',
      'mcp',
      'memory',
      'pull',
      'workflow',
    ].sort(),
  );
});
