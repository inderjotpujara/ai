import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { transcribe as defaultTranscribe } from './audio/transcribe.ts';
import { captureClipboardImage } from './clipboard.ts';
import type { MediaStore } from './store.ts';
import { type MediaItem, MediaKind } from './types.ts';
import { sampleFrames as defaultSampleFrames } from './video/frames.ts';

export type IngestFlags = {
  images: string[];
  audios: string[];
  videos: string[];
  paste: boolean;
};

export type IngestResult = { prompt: string; items: MediaItem[] };

type IngestDeps = {
  capturePaste?: typeof captureClipboardImage;
  transcribe?: (path: string) => Promise<string>;
  sampleFrames?: (path: string, store: MediaStore) => Promise<MediaItem>;
  exists?: (p: string) => boolean;
  mediaTypeOf?: (p: string) => string;
};

type ResolvedDeps = Required<IngestDeps>;

const EXT_MEDIA_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function defaultMediaTypeOf(path: string): string {
  return EXT_MEDIA_TYPE[extname(path).toLowerCase()] ?? '';
}

function kindOf(mediaType: string): MediaKind | undefined {
  if (mediaType.startsWith('image/')) return MediaKind.Image;
  if (mediaType.startsWith('audio/')) return MediaKind.Audio;
  if (mediaType.startsWith('video/')) return MediaKind.Video;
  return undefined;
}

function resolveDeps(deps: IngestDeps): ResolvedDeps {
  return {
    capturePaste: deps.capturePaste ?? captureClipboardImage,
    transcribe: deps.transcribe ?? defaultTranscribe,
    sampleFrames: deps.sampleFrames ?? defaultSampleFrames,
    exists: deps.exists ?? existsSync,
    mediaTypeOf: deps.mediaTypeOf ?? defaultMediaTypeOf,
  };
}

async function ingestFlags(
  flags: IngestFlags,
  store: MediaStore,
  deps: ResolvedDeps,
  items: MediaItem[],
): Promise<string> {
  let suffix = '';

  for (const path of flags.images) {
    const item = await store.putFile(
      MediaKind.Image,
      path,
      deps.mediaTypeOf(path),
    );
    items.push(item);
    suffix += ` [img:${item.handle}]`;
  }

  for (const path of flags.videos) {
    const item = await deps.sampleFrames(path, store);
    items.push(item);
    suffix += ` [video:${item.handle}]`;
  }

  for (const path of flags.audios) {
    const text = await deps.transcribe(path);
    suffix += `\n\nTranscript:\n${text}`;
  }

  if (flags.paste) {
    const pasted = await deps.capturePaste();
    if (pasted) {
      const item = await store.put(
        MediaKind.Image,
        pasted.bytes,
        pasted.mediaType,
      );
      items.push(item);
      suffix += ` [img:${item.handle}]`;
    }
  }

  return suffix;
}

/** Auto-detects dragged-in filesystem paths embedded in the prompt text and
 * handles each like the matching `--image`/`--video`/`--audio` flag. */
async function autoDetectPaths(
  prompt: string,
  store: MediaStore,
  deps: ResolvedDeps,
  items: MediaItem[],
): Promise<string> {
  const tokens = prompt.split(/(\s+)/);
  let transcriptSuffix = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || /^\s*$/.test(token) || !deps.exists(token)) continue;

    const mediaType = deps.mediaTypeOf(token);
    const kind = kindOf(mediaType);
    if (!kind) continue;

    if (kind === MediaKind.Image) {
      const item = await store.putFile(MediaKind.Image, token, mediaType);
      items.push(item);
      tokens[i] = `[img:${item.handle}]`;
    } else if (kind === MediaKind.Video) {
      const item = await deps.sampleFrames(token, store);
      items.push(item);
      tokens[i] = `[video:${item.handle}]`;
    } else {
      const text = await deps.transcribe(token);
      transcriptSuffix += `\n\nTranscript:\n${text}`;
      tokens[i] = '';
    }
  }

  return tokens.join('') + transcriptSuffix;
}

/**
 * Turns CLI media input (flags + dragged-in paths + clipboard paste) into
 * stored media handles and a prompt rewritten with `[img:h]`/`[video:h]`
 * markers. Audio becomes text: transcripts are spliced into the prompt with
 * no marker, per the media-by-reference/audio-as-text design.
 */
export async function ingestMedia(
  rawPrompt: string,
  flags: IngestFlags,
  store: MediaStore,
  deps: IngestDeps = {},
): Promise<IngestResult> {
  const resolved = resolveDeps(deps);
  const items: MediaItem[] = [];

  const withAutoDetect = await autoDetectPaths(
    rawPrompt,
    store,
    resolved,
    items,
  );
  const flagSuffix = await ingestFlags(flags, store, resolved, items);

  return { prompt: withAutoDetect + flagSuffix, items };
}
