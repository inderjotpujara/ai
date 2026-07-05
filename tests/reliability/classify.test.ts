import { describe, expect, it } from 'bun:test';
import { APICallError } from 'ai';
import {
  ProviderError,
  ResourceError,
  ToolError,
} from '../../src/core/errors.ts';
import { classify, Lane } from '../../src/reliability/classify.ts';

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'http://x',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

describe('classify', () => {
  it('retryable API errors are Transient', () => {
    expect(classify(apiError(429, true))).toBe(Lane.Transient);
    expect(classify(apiError(503, true))).toBe(Lane.Transient);
  });
  it('non-retryable client API errors are Terminal', () => {
    expect(classify(apiError(400, false))).toBe(Lane.Terminal);
    expect(classify(apiError(401, false))).toBe(Lane.Terminal);
  });
  it('ProviderError and ResourceError are RouteWorthy', () => {
    expect(classify(new ProviderError('pull failed'))).toBe(Lane.RouteWorthy);
    expect(classify(new ResourceError('no fit'))).toBe(Lane.RouteWorthy);
  });
  it('ToolError is Terminal', () => {
    expect(classify(new ToolError('bad args'))).toBe(Lane.Terminal);
  });
  it('network reset codes are Transient', () => {
    const e = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(classify(e)).toBe(Lane.Transient);
  });
  it('unknown errors fail safe to Terminal', () => {
    expect(classify(new Error('mystery'))).toBe(Lane.Terminal);
    expect(classify('a string')).toBe(Lane.Terminal);
  });
});
