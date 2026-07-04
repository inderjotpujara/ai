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

/** Result of a single download, surfacing signals telemetry can report truthfully. */
export type DownloadOutcome = {
  /** True when the download recorded a hash without verifying it against a
   *  known source oid first (compute-and-record, no gate) rather than
   *  gating acceptance on a match against a trusted digest. Currently only
   *  meaningful for the HF providers (an HF tree-listing failure or a
   *  missing per-file oid means we record sha256 but never had anything to
   *  check it against). Ollama/LM Studio verify integrity inside their own
   *  daemons — we have no signal either way, so providers that don't return
   *  an outcome are treated as `false` (approximation, not a positive claim
   *  that they verified).
   */
  deferredVerify: boolean;
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
  ): // Ollama/LM Studio return no outcome; `void` (not `undefined`) is what
  // makes an implicit `return;`/no-return async body assignable here
  // without every provider needing an explicit `return undefined`.
  // biome-ignore lint/suspicious/noConfusingVoidType: see comment above
  Promise<DownloadOutcome | void>;
};
