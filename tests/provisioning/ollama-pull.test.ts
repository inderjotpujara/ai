import { describe, expect, it } from 'bun:test';
import { parseOllamaLine, OllamaPullAggregator } from '../../src/provisioning/ollama-pull.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';
import { ProgressTracker } from '../../src/provisioning/progress-tracker.ts';

describe('parseOllamaLine', () => {
  it('maps "pulling manifest" to Resolving', () => {
    expect(parseOllamaLine('{"status":"pulling manifest"}')?.phase).toBe(DownloadPhase.Resolving);
  });
  it('treats presence of digest+total+completed as Downloading regardless of verb', () => {
    const r = parseOllamaLine('{"status":"pulling 12ab","digest":"sha256:12ab","total":100,"completed":40}');
    expect(r?.phase).toBe(DownloadPhase.Downloading);
    expect(r?.completed).toBe(40);
    expect(r?.digest).toBe('sha256:12ab');
  });
  it('maps "verifying sha256 digest" to Verifying', () => {
    expect(parseOllamaLine('{"status":"verifying sha256 digest"}')?.phase).toBe(DownloadPhase.Verifying);
  });
  it('maps "success" to Done', () => {
    expect(parseOllamaLine('{"status":"success"}')?.phase).toBe(DownloadPhase.Done);
  });
  it('returns null for a blank line', () => {
    expect(parseOllamaLine('')).toBeNull();
  });
  it('maps an in-band {"error":...} line to Failed with the error message', () => {
    const r = parseOllamaLine('{"error":"digest mismatch, file must be downloaded again"}');
    expect(r?.phase).toBe(DownloadPhase.Failed);
    expect(r?.error).toBe('digest mismatch, file must be downloaded again');
  });
});

describe('OllamaPullAggregator', () => {
  it('aggregates per-layer completed/total by replacing (not summing) per digest', () => {
    const agg = new OllamaPullAggregator(new ProgressTracker('m', () => 0));
    agg.feed('{"status":"pulling manifest"}');
    agg.feed('{"digest":"a","total":100,"completed":50}');
    agg.feed('{"digest":"b","total":100,"completed":10}');
    const p = agg.feed('{"digest":"a","total":100,"completed":90}'); // replaces a=50 → 90
    expect(p?.bytesCompleted).toBe(100); // 90 + 10
    expect(p?.bytesTotal).toBe(200);
  });
  it('surfaces an in-band error line as a Failed progress event carrying the error', () => {
    const agg = new OllamaPullAggregator(new ProgressTracker('m', () => 0));
    agg.feed('{"digest":"a","total":100,"completed":50}');
    const p = agg.feed('{"error":"digest mismatch, file must be downloaded again"}');
    expect(p?.phase).toBe(DownloadPhase.Failed);
    expect(p?.error).toBe('digest mismatch, file must be downloaded again');
  });
});
