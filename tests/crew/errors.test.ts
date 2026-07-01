import { describe, expect, it } from 'bun:test';
import { CrewError } from '../../src/core/errors.ts';

describe('CrewError', () => {
  it('is an Error with the right name', () => {
    const e = new CrewError('bad crew');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('CrewError');
    expect(e.message).toBe('bad crew');
  });
});
