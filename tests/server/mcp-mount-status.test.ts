import { expect, test } from 'bun:test';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';

test('records and retrieves a mount outcome by server name; unrecorded names are undefined', () => {
  const status = createMcpMountStatus();
  expect(status.get('gh')).toBeUndefined();
  status.record('gh', 'mounted');
  expect(status.get('gh')).toEqual({ status: 'mounted' });
  status.record('gh', 'skipped', 'consent not granted');
  expect(status.get('gh')).toEqual({
    status: 'skipped',
    reason: 'consent not granted',
  });
});
