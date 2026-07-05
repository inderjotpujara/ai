import { describe, expect, it } from 'bun:test';
import { withWallClock as fromReliability } from '../../src/reliability/timeout.ts';
import { withWallClock as fromDryRun } from '../../src/verified-build/dry-run.ts';

describe('withWallClock re-export', () => {
  it('verified-build re-exports the reliability implementation', () => {
    expect(fromDryRun).toBe(fromReliability);
  });
});
