import { describe, expect, it } from 'bun:test';
import { ProgressTracker } from '../../src/provisioning/progress-tracker.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

describe('ProgressTracker', () => {
  it('derives percent from completed/total', () => {
    const t = new ProgressTracker('m', () => 0);
    const p = t.update(DownloadPhase.Downloading, 50, 100);
    expect(p.percent).toBe(50);
  });

  it('clamps percent monotonic when the source reports backwards', () => {
    const now = 0;
    const t = new ProgressTracker('m', () => now);
    t.update(DownloadPhase.Downloading, 80, 100); // 80%
    const p = t.update(DownloadPhase.Downloading, 60, 100); // source went backwards
    expect(p.percent).toBe(80); // never regresses
  });

  it('leaves percent null when total is unknown', () => {
    const t = new ProgressTracker('m', () => 0);
    const p = t.update(DownloadPhase.Resolving, 0, null);
    expect(p.percent).toBeNull();
  });

  it('derives a positive EWMA speed from bytes over time', () => {
    let now = 0;
    const t = new ProgressTracker('m', () => now);
    t.update(DownloadPhase.Downloading, 0, 1000);
    now = 1000; // +1s
    const p = t.update(DownloadPhase.Downloading, 500, 1000); // +500 bytes in 1s
    expect(p.speedBytesPerSec).toBeGreaterThan(0);
  });
});
