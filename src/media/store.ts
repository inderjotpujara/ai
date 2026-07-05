import { mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type FileHandle,
  type MediaHandle,
  type MediaItem,
  MediaKind,
} from './types.ts';

export type MediaStore = {
  put(
    kind: MediaKind,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<MediaItem>;
  putFile(
    kind: MediaKind,
    srcPath: string,
    mediaType: string,
  ): Promise<MediaItem>;
  get(handle: MediaHandle): MediaItem | undefined;
  resolveBytes(handle: MediaHandle): Promise<Uint8Array>;
  toFileHandle(item: MediaItem): FileHandle;
};

const KIND_PREFIX: Record<MediaKind, string> = {
  [MediaKind.Image]: 'img',
  [MediaKind.Audio]: 'aud',
  [MediaKind.Video]: 'vid',
};

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

function defaultIdFor(kind: MediaKind, n: number): string {
  return `${KIND_PREFIX[kind]}_${n}`;
}

function extFor(mediaType: string): string {
  const known = EXT_BY_MEDIA_TYPE[mediaType];
  if (known) return known;
  const subtype = mediaType.split('/')[1];
  return subtype ?? mediaType;
}

export function createMediaStore(
  runDir: string,
  deps?: { idFor?: (kind: MediaKind, n: number) => string },
): MediaStore {
  const idFor = deps?.idFor ?? defaultIdFor;
  const mediaDir = join(runDir, 'media');
  const items = new Map<MediaHandle, MediaItem>();
  const counters: Record<MediaKind, number> = {
    [MediaKind.Image]: 0,
    [MediaKind.Audio]: 0,
    [MediaKind.Video]: 0,
  };

  function mintItem(kind: MediaKind, mediaType: string): MediaItem {
    counters[kind] += 1;
    const handle = idFor(kind, counters[kind]);
    const path = join(mediaDir, `${handle}.${extFor(mediaType)}`);
    return { handle, kind, path, mediaType };
  }

  async function put(
    kind: MediaKind,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<MediaItem> {
    const item = mintItem(kind, mediaType);
    mkdirSync(mediaDir, { recursive: true });
    await writeFile(item.path, bytes);
    items.set(item.handle, item);
    return item;
  }

  async function putFile(
    kind: MediaKind,
    srcPath: string,
    mediaType: string,
  ): Promise<MediaItem> {
    const bytes = await readFile(srcPath);
    return put(kind, bytes, mediaType);
  }

  function get(handle: MediaHandle): MediaItem | undefined {
    return items.get(handle);
  }

  async function resolveBytes(handle: MediaHandle): Promise<Uint8Array> {
    const item = items.get(handle);
    if (!item) throw new Error(`unknown media handle: ${handle}`);
    return await readFile(item.path);
  }

  function toFileHandle(item: MediaItem): FileHandle {
    return {
      uri: `file://${item.path}`,
      mediaType: item.mediaType,
      sizeBytes: statSync(item.path).size,
    };
  }

  return { put, putFile, get, resolveBytes, toFileHandle };
}
