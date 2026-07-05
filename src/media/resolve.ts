import type { MediaStore } from './store.ts';
import { type MediaFilePart, type MediaHandle, MediaKind } from './types.ts';

export const MARKER_RE = /\[(img|audio|video):([a-z0-9_]+)\]/g;

export function extractHandles(task: string): MediaHandle[] {
  const handles: MediaHandle[] = [];
  for (const match of task.matchAll(MARKER_RE)) {
    const handle = match[2];
    if (handle) handles.push(handle);
  }
  return handles;
}

const RESOLVABLE_KINDS = new Set<MediaKind>([MediaKind.Image, MediaKind.Video]);

export async function resolveAttachments(
  task: string,
  store: MediaStore,
): Promise<MediaFilePart[]> {
  const parts: MediaFilePart[] = [];
  for (const handle of extractHandles(task)) {
    const item = store.get(handle);
    if (!item) continue;
    if (!RESOLVABLE_KINDS.has(item.kind)) continue;
    const data = await store.resolveBytes(handle);
    parts.push({ type: 'file', mediaType: item.mediaType, data });
  }
  return parts;
}
