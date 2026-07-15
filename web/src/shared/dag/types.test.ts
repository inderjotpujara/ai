import { describe, expect, it } from 'vitest';
import { DagStatus } from './types.ts';

describe('DagStatus', () => {
  it('has a Proposed member for a staged, not-yet-committed node (Phase 5 D6)', () => {
    expect(DagStatus.Proposed).toBe('proposed');
  });
});
