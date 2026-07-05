import { describe, expect, it } from 'bun:test';
import {
  defaultDownloadRetry,
  downloadStallMs,
} from '../../src/reliability/download-retry.ts';

describe('download retry defaults', () => {
  it('provides positive backoff parameters', () => {
    const r = defaultDownloadRetry();
    expect(r.attempts).toBeGreaterThan(0);
    expect(r.capMs).toBeGreaterThanOrEqual(r.baseMs);
    expect(typeof r.jitter()).toBe('number');
    expect(downloadStallMs()).toBeGreaterThan(0);
  });
});
