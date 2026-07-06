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
    if (item.kind === MediaKind.Video) {
      // A video item's own `path` is a frame-group placeholder directory,
      // not a real file — it must never be `readFile`d directly (EISDIR).
      // With no resolvable frames there is nothing to attach; skip the item
      // entirely rather than falling through to the generic resolve below.
      if (!item.frames || item.frames.length === 0) continue;
      for (const frameHandle of item.frames) {
        const frameItem = store.get(frameHandle);
        if (!frameItem) continue;
        const bytes = await store.resolveBytes(frameHandle);
        parts.push({
          type: 'file',
          mediaType: frameItem.mediaType,
          data: Buffer.from(bytes).toString('base64'),
        });
      }
      continue;
    }
    const bytes = await store.resolveBytes(handle);
    parts.push({
      type: 'file',
      mediaType: item.mediaType,
      data: Buffer.from(bytes).toString('base64'),
    });
  }
  return parts;
}
