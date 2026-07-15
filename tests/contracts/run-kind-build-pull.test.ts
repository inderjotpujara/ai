import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';

test('RunKind gains Build/Pull members (Slice 30b Phase 5)', () => {
  expect(RunKind.Build as string).toBe('build');
  expect(RunKind.Pull as string).toBe('pull');
  expect((Object.values(RunKind) as string[]).sort()).toEqual(
    ['agent', 'build', 'chat', 'crew', 'pull', 'workflow'].sort(),
  );
});
