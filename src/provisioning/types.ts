import type { ProviderKind } from '../core/types.ts';

/** Lifecycle phase of a single model download, normalized across runtimes. */
export enum DownloadPhase {
  Resolving = 'resolving', // fetching manifest / metadata / size
  Downloading = 'downloading',
  Verifying = 'verifying', // sha256 / digest / checksum
  Finalizing = 'finalizing', // atomic rename / cache commit / install confirm
  Done = 'done',
  Failed = 'failed',
}

/** A normalized progress event emitted by every DownloadProvider. */
export type DownloadProgress = {
  modelRef: string;
  phase: DownloadPhase;
  bytesCompleted: number;
  bytesTotal: number | null; // null until known
  percent: number | null; // derived, clamped monotonic; null when total unknown
  speedBytesPerSec: number | null; // derived (EWMA) except LM Studio native
  error?: string;
};

/** Runtime-agnostic model downloader. One adapter per runtime. */
export type DownloadProvider = {
  readonly kind: ProviderKind;
  download(
    modelRef: string,
    opts: {
      onProgress: (p: DownloadProgress) => void;
      signal: AbortSignal;
      destDir: string;
    },
  ): Promise<void>;
};
