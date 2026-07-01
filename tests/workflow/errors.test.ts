import { describe, expect, it } from 'bun:test';
import { WorkflowError } from '../../src/core/errors.ts';

describe('WorkflowError', () => {
  it('is an Error with the right name', () => {
    const e = new WorkflowError('bad def');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('WorkflowError');
    expect(e.message).toBe('bad def');
  });
});
