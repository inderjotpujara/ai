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
};

export type MediaFilePart = {
  type: 'file';
  mediaType: string;
  data: Uint8Array;
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
