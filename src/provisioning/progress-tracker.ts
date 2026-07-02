import { DownloadPhase, type DownloadProgress } from './types.ts';

const EWMA_ALPHA = 0.3; // smoothing for bursty parallel-part throughput

/** Accumulates raw per-event bytes into a clamped, smoothed DownloadProgress. */
export class ProgressTracker {
  private maxPercent = 0;
  private lastBytes = 0;
  private lastTime: number | null = null;
  private speed: number | null = null;
  private last: DownloadProgress;

  constructor(
    private readonly modelRef: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.last = {
      modelRef,
      phase: DownloadPhase.Resolving,
      bytesCompleted: 0,
      bytesTotal: null,
      percent: null,
      speedBytesPerSec: null,
    };
  }

  update(
    phase: DownloadPhase,
    bytesCompleted: number,
    bytesTotal: number | null,
  ): DownloadProgress {
    // Monotonic percent: never regress even if the source reports backwards.
    let percent: number | null = null;
    if (bytesTotal && bytesTotal > 0) {
      const raw = Math.min(100, (bytesCompleted / bytesTotal) * 100);
      this.maxPercent = Math.max(this.maxPercent, raw);
      percent = this.maxPercent;
    }
    // EWMA speed from byte delta over wall-clock delta.
    const t = this.now();
    if (this.lastTime !== null) {
      const dt = (t - this.lastTime) / 1000;
      const db = bytesCompleted - this.lastBytes;
      if (dt > 0 && db >= 0) {
        const inst = db / dt;
        this.speed =
          this.speed === null
            ? inst
            : EWMA_ALPHA * inst + (1 - EWMA_ALPHA) * this.speed;
      }
    }
    this.lastTime = t;
    this.lastBytes = bytesCompleted;
    this.last = {
      modelRef: this.modelRef,
      phase,
      bytesCompleted,
      bytesTotal,
      percent,
      speedBytesPerSec: this.speed,
    };
    return this.last;
  }

  snapshot(): DownloadProgress {
    return this.last;
  }
}
