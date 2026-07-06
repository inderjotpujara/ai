export enum MediaKind {
  Image = 'image',
  Audio = 'audio',
  Video = 'video',
}

export type MediaHandle = string; // short opaque id, e.g. 'img_a1b2'

export type MediaItem = {
  handle: MediaHandle;
  kind: MediaKind;
  path: string;
  mediaType: string;
  /** Child image handles of a video frame-group (set only on group items). */
  frames?: MediaHandle[];
};

export type MediaFilePart = {
  type: 'file';
  mediaType: string;
  /** Base64-encoded bytes. Live-verify caught that a raw Uint8Array here is
   *  rejected by Ollama (`images[]` wants base64 strings — JSON-serializing a
   *  Uint8Array yields an object → 400). Base64 works across the AI-SDK v6
   *  FilePart contract and every provider. */
  data: string;
};

export type ResolvedMedia = { parts: MediaFilePart[] } | { transcript: string };

export type FileHandle = {
  uri: string;
  mediaType: string;
  sizeBytes: number;
  previewUri?: string;
};

export enum ExecMode {
  OneShot = 'one_shot',
  Server = 'server',
}

export enum JobStatus {
  Submitted = 'submitted',
  Working = 'working',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export type JobProgress = {
  fraction?: number;
  message: string;
  previewUri?: string;
};

export type JobHandle = {
  jobId: string;
  status(): JobStatus;
  progress: AsyncIterable<JobProgress>;
  result(): Promise<FileHandle>;
  cancel(): Promise<void>;
};
