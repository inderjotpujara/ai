import { describe, expect, it } from 'bun:test';
import { DownloadPhase } from '../../src/provisioning/types.ts';
import {
  formatBytes,
  formatEta,
  formatSpeed,
  renderProgressLine,
} from '../../src/provisioning/ui/format.ts';

describe('formatters', () => {
  it('formats bytes human-readably', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2_100_000_000)).toBe('2.0 GB');
  });
  it('formats speed and handles null', () => {
    expect(formatSpeed(null)).toBe('—');
    expect(formatSpeed(1_048_576)).toBe('1.0 MB/s');
  });
  it('formats ETA and handles unknown', () => {
    expect(formatEta(1000, null)).toBe('—');
    expect(formatEta(1_000_000, 500_000)).toBe('2s');
  });
  it('renders a progress line with model, percent, size, speed', () => {
    const line = renderProgressLine({
      modelRef: 'qwen3.5:4b',
      phase: DownloadPhase.Downloading,
      bytesCompleted: 500_000_000,
      bytesTotal: 1_000_000_000,
      percent: 50,
      speedBytesPerSec: 1_048_576,
    });
    expect(line).toContain('qwen3.5:4b');
    expect(line).toContain('50%');
  });
});
