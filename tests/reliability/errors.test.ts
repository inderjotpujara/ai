import { describe, expect, it } from 'bun:test';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

describe('CircuitOpenError', () => {
  it('carries the dependency id and a stable name', () => {
    const e = new CircuitOpenError('mcp:github');
    expect(e.dependencyId).toBe('mcp:github');
    expect(e.name).toBe('CircuitOpenError');
    expect(e.message).toContain('mcp:github');
    expect(e instanceof Error).toBe(true);
  });
});
