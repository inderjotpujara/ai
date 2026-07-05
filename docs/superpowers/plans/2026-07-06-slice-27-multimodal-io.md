# Slice 27 — Full multimodal I/O + uncensored — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent analyze and generate across text/image/audio/video, local-first, with an uncensored policy axis shipped default-on.

**Architecture:** One new `src/media/` subsystem whose run-scoped artifact store is the hub for both directions. Analysis writes incoming media → hands the specialist a read handle it resolves into AI-SDK v6 `FilePart`s; generation runs engines as subprocesses (one unified `MediaGenerator` adapter with `ExecMode.OneShot|Server`, reusing the Slice-26 managed-subprocess base) and returns a file handle. Media never crosses the router→specialist string boundary as bytes (media-by-reference). Media models are capability-tagged candidates ranked by the existing hardware-fit selector.

**Tech Stack:** TypeScript, Bun, AI SDK v6 (`ai@6.0.217`), `ollama-ai-provider-v2`, OpenTelemetry spans, external CLIs spawned via `Bun.spawn`: `ffmpeg`, `mlx_whisper`, `mflux`, `mlx-audio`, `mlx-video`; ComfyUI (server lane).

## Global Constraints

- **bun only** — `bun run typecheck`, `bun test`, `bun run lint:file`. Never npm.
- **Prefer `enum` over string-literal unions** for finite named sets; string enums only (`enum Foo { A = 'A' }`). Discriminated unions stay `type`.
- **Early returns; small focused files; descriptive names; typed errors.** No `console.log` left behind.
- **Never hardcode model choices/budgets/limits — compute live; env vars are fallback-only.** Media models are capability-tagged candidates chosen by the fit selector, not hardcoded ids.
- **AI SDK v6 media parts: use `{ type: 'file', mediaType, data }` — `type: 'image'` is DEPRECATED.** `mediaType` must be a precise IANA type (`image/png`, `image/jpeg`).
- **Tests use `bun:test` with dependency injection + hand-rolled fakes** cast `as unknown as typeof fetch` (or an injected `SpawnFn`). No `mock()`/`spyOn`.
- **Consent-before-download** on every model/weight pull; **degrade-never-crash** on any missing engine/model/file.
- **Uncensored is default-on**; the `content_policy` label/telemetry and the "filters removed ≠ legal obligations removed" copy are labeling only — **no gate, no refusal path, no classifier.** Voice-cloning has its own separate consent affirmation.
- Each task: run FOCUSED tests + `bun run typecheck` + `bun run lint:file` inline, then commit. Controller runs full `bun test` between tasks.

---

## File structure

```
src/core/types.ts                 (modify) + Capability.{ImageGen,SpeechGen,VideoGen}
src/core/agent.ts                 (modify) RunAgentInput.attachments? -> messages: path
src/core/agent-def.ts             (modify) resolve handle-markers in task -> attachments
src/media/types.ts                (create) MediaKind, MediaHandle, MediaItem, ResolvedMedia, FileHandle, JobHandle, ExecMode
src/media/store.ts                (create) run-scoped artifact store
src/media/resolve.ts              (create) marker scan -> FilePart[] / transcript
src/media/clipboard.ts            (create) macOS clipboard image capture
src/media/ingest.ts               (create) CLI input -> stored media + rewritten prompt
src/media/audio/transcribe.ts     (create) mlx_whisper spawn -> transcript
src/media/video/frames.ts         (create) ffmpeg sample -> frame handles
src/media/generate/adapter.ts     (create) MediaGenerator (OneShot|Server) -> JobHandle
src/media/generate/image-mflux.ts (create) image generator strategy
src/media/generate/audio-mlx.ts   (create) TTS generator strategy
src/media/generate/video-mlx.ts   (create) video generator strategy
src/media/generate/tools.ts       (create) generate_image/generate_speech/generate_video tool set
src/media/policy.ts               (create) ContentPolicy switch (default ON) + uncensored predicate + safety-checker-disable
models/qwen-vision.ts             (create) vision ModelDeclaration
agents/vision.ts                  (create) vision analysis specialist
agents/media-creator.ts           (create) generation specialist (owns generate_* tools)
agents/index.ts                   (modify) register vision + media_creator
src/cli/chat.ts                   (modify) parseArgs for --image/--audio/--video/--paste; wire ingest
src/telemetry/spans.ts            (modify) ATTR.INPUT_MODALITY/CONTENT_POLICY + withTranscribeSpan/withFrameSampleSpan/withGenerateSpan
src/provisioning/catalog/snapshot.json (modify) add media model entries
tests/media/**                    (create) unit tests
tests/integration/multimodal.live.test.ts (create) gated live-verify (MULTIMODAL_LIVE=1)
```

---

# PHASE A — Analysis (vision + audio-STT + video-frames)

### Task A1: Capability enum — generation axes

**Files:**
- Modify: `src/core/types.ts` (the `Capability` enum, ~lines 17-23)
- Test: `tests/media/capability.test.ts`

**Interfaces:**
- Produces: `Capability.ImageGen = 'image_gen'`, `Capability.SpeechGen = 'speech_gen'`, `Capability.VideoGen = 'video_gen'` (added to the existing enum alongside `Tools`, `Vision`, `Audio`, `Video`).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { Capability } from '../../src/core/types.ts';

test('generation capabilities are declared', () => {
  expect(Capability.ImageGen).toBe('image_gen');
  expect(Capability.SpeechGen).toBe('speech_gen');
  expect(Capability.VideoGen).toBe('video_gen');
});
```

- [ ] **Step 2: Run — expect FAIL** (`bun test tests/media/capability.test.ts`) — "ImageGen does not exist".
- [ ] **Step 3: Implement** — add to the enum in `src/core/types.ts`:

```ts
export enum Capability {
  Tools = 'tools',
  Vision = 'vision', // image input (Slice 8)
  Audio = 'audio', // speech in/out (Slice 9)
  Video = 'video', // frames/clips (Slice 10)
  ImageGen = 'image_gen', // text->image generation (Slice 27)
  SpeechGen = 'speech_gen', // text->speech generation (Slice 27)
  VideoGen = 'video_gen', // text/image->video generation (Slice 27)
}
```

- [ ] **Step 4: Run — expect PASS**; `bun run typecheck`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): add ImageGen/SpeechGen/VideoGen capabilities"`

---

### Task A2: media types

**Files:**
- Create: `src/media/types.ts`
- Test: `tests/media/types.test.ts`

**Interfaces:**
- Produces:
```ts
export enum MediaKind { Image = 'image', Audio = 'audio', Video = 'video' }
export type MediaHandle = string; // short opaque id, e.g. 'img_a1b2'
export type MediaItem = { handle: MediaHandle; kind: MediaKind; path: string; mediaType: string };
export type MediaFilePart = { type: 'file'; mediaType: string; data: Uint8Array };
export type ResolvedMedia = { parts: MediaFilePart[] } | { transcript: string };
export type FileHandle = { uri: string; mediaType: string; sizeBytes: number; previewUri?: string };
export type ExecMode = 'one_shot' | 'server';
export enum JobStatus { Submitted = 'submitted', Working = 'working', Completed = 'completed', Failed = 'failed', Cancelled = 'cancelled' }
export type JobProgress = { fraction?: number; message: string; previewUri?: string };
export type JobHandle = {
  jobId: string;
  status(): JobStatus;
  progress: AsyncIterable<JobProgress>;
  result(): Promise<FileHandle>;
  cancel(): Promise<void>;
};
```

- [ ] **Step 1: Write the failing test** — assert the enum values + that a `MediaFilePart` literal with `type:'file'` typechecks:

```ts
import { expect, test } from 'bun:test';
import { MediaKind, JobStatus } from '../../src/media/types.ts';

test('media kinds and job statuses are declared', () => {
  expect(MediaKind.Image).toBe('image');
  expect(MediaKind.Audio).toBe('audio');
  expect(MediaKind.Video).toBe('video');
  expect(JobStatus.Completed).toBe('completed');
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).
- [ ] **Step 3: Implement** — create `src/media/types.ts` with the Interfaces block above.
- [ ] **Step 4: Run — expect PASS**; `bun run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): media + job types"`

---

### Task A3: run-scoped media store

**Files:**
- Create: `src/media/store.ts`
- Test: `tests/media/store.test.ts`

**Interfaces:**
- Consumes: `MediaKind`, `MediaHandle`, `MediaItem`, `FileHandle` (A2).
- Produces:
```ts
export type MediaStore = {
  put(kind: MediaKind, bytes: Uint8Array, mediaType: string): Promise<MediaItem>; // writes runs/<id>/media/<handle>.<ext>, mints handle
  putFile(kind: MediaKind, srcPath: string, mediaType: string): Promise<MediaItem>;
  get(handle: MediaHandle): MediaItem | undefined;
  resolveBytes(handle: MediaHandle): Promise<Uint8Array>;
  toFileHandle(item: MediaItem): FileHandle;
};
export function createMediaStore(runDir: string, deps?: { idFor?: (kind: MediaKind, n: number) => string }): MediaStore;
```
Handle format: `<kindPrefix>_<counter>` (e.g. `img_1`) — deterministic via injectable `idFor` (no `Math.random`, which is banned in some contexts; here we use a monotonic counter). Files under `<runDir>/media/`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';

test('put mints a handle, writes bytes, and resolves them back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mediastore-'));
  const store = createMediaStore(dir);
  const item = await store.put(MediaKind.Image, new Uint8Array([1, 2, 3]), 'image/png');
  expect(item.handle).toBe('img_1');
  expect(item.path).toBe(join(dir, 'media', 'img_1.png'));
  expect(store.get('img_1')).toEqual(item);
  const bytes = await store.resolveBytes('img_1');
  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  const fh = store.toFileHandle(item);
  expect(fh.uri).toBe(`file://${item.path}`);
  expect(fh.sizeBytes).toBe(3);
});

test('resolveBytes throws a typed error for an unknown handle', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mediastore-')));
  await expect(store.resolveBytes('img_99')).rejects.toThrow('unknown media handle');
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** `src/media/store.ts` — monotonic counter per kind, `mkdirSync(media, {recursive:true})`, `writeFile`, ext-from-mediaType map (`image/png`→`png`, `image/jpeg`→`jpg`, `audio/wav`→`wav`, `video/mp4`→`mp4`), a `Map<handle, MediaItem>`. `resolveBytes` throws `Error('unknown media handle: ' + handle)` when absent.
- [ ] **Step 4: Run — expect PASS**; `bun run typecheck`; `bun run lint:file -- src/media/store.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): run-scoped artifact store"`

---

### Task A4: handle-marker resolver

**Files:**
- Create: `src/media/resolve.ts`
- Test: `tests/media/resolve.test.ts`

**Interfaces:**
- Consumes: `MediaStore` (A3), `MediaFilePart` (A2).
- Produces:
```ts
export const MARKER_RE: RegExp; // matches [img:<h>] [audio:<h>] [video:<h>]
export function extractHandles(task: string): MediaHandle[];
export async function resolveAttachments(task: string, store: MediaStore): Promise<MediaFilePart[]>;
```
`resolveAttachments` maps every image/video-frame handle in the task to a `{type:'file', mediaType, data}` part (video-frame group → multiple parts). Audio handles are NOT resolved here (audio is transcribed to text at ingest — see A12/A8).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { extractHandles, resolveAttachments } from '../../src/media/resolve.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('extractHandles finds image and video markers', () => {
  expect(extractHandles('what is in [img:img_1] and [video:vid_2]?')).toEqual(['img_1', 'vid_2']);
});

test('resolveAttachments materializes image parts as v6 file parts', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'res-')));
  const item = await store.put(MediaKind.Image, new Uint8Array([9]), 'image/png');
  const parts = await resolveAttachments(`describe [${'img'}:${item.handle}]`, store);
  expect(parts).toEqual([{ type: 'file', mediaType: 'image/png', data: new Uint8Array([9]) }]);
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — `MARKER_RE = /\[(img|audio|video):([a-z0-9_]+)\]/g`; `extractHandles` collects capture group 2; `resolveAttachments` filters to image/video handles present in the store, reads bytes, emits `{type:'file', mediaType: item.mediaType, data}`.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): handle-marker resolver -> v6 file parts"`

---

### Task A5: widen `RunAgentInput` to carry attachments

**Files:**
- Modify: `src/core/agent.ts` (`RunAgentInput` ~15-25; the `generateText` call ~33-48)
- Test: `tests/media/agent-attachments.test.ts`

**Interfaces:**
- Consumes: `MediaFilePart` (A2).
- Produces: `RunAgentInput.attachments?: MediaFilePart[]`. When present + non-empty, `runAgent` calls `generateText` with `messages: [{ role: 'user', content: [{type:'text', text: prompt}, ...attachments] }]` instead of `prompt`.

- [ ] **Step 1: Write the failing test** — inject a fake model capturing its call args (AI SDK `LanguageModelV2` mock is heavy; instead test the message-builder helper). Extract a pure helper `buildPromptOrMessages(prompt, attachments)` and test it:

```ts
import { expect, test } from 'bun:test';
import { buildCallInput } from '../../src/core/agent.ts';

test('no attachments -> prompt string', () => {
  expect(buildCallInput('hello', undefined)).toEqual({ prompt: 'hello' });
});

test('attachments -> messages with text + file parts', () => {
  const att = [{ type: 'file' as const, mediaType: 'image/png', data: new Uint8Array([1]) }];
  expect(buildCallInput('describe', att)).toEqual({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'describe' }, ...att] }],
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`buildCallInput` not exported).
- [ ] **Step 3: Implement** — add `attachments?: MediaFilePart[]` to `RunAgentInput`; export `buildCallInput(prompt, attachments)` returning `{prompt}` or `{messages}`; in the `generateText(...)` call spread `...buildCallInput(input.prompt, input.attachments)` in place of `prompt: input.prompt`.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): runAgent accepts media attachments -> messages"`

---

### Task A6: specialist rehydrates handles from the task

**Files:**
- Modify: `src/core/agent-def.ts` (`runDefinedAgent`, ~30-46)
- Test: `tests/media/agent-def-resolve.test.ts`

**Interfaces:**
- Consumes: `resolveAttachments` (A4), `MediaStore` (A3), `RunAgentInput.attachments` (A5).
- Produces: `runDefinedAgent` gains an optional `mediaStore?: MediaStore` param; when set, it calls `resolveAttachments(task, mediaStore)` and passes the result as `attachments` to `runAgent`.

- [ ] **Step 1: Write the failing test** — inject a fake `runAgent` via a seam. Add `runDefinedAgent(agent, task, numCtx?, modelOverride?, abortSignal?, mediaStore?)`; test that when a store with `img_1` is passed and the task contains `[img:img_1]`, the attachments reach the model call. (Use a fake agent whose `model` records the last call; assert the resolved part count.)

```ts
import { expect, test } from 'bun:test';
import { resolveAttachments } from '../../src/media/resolve.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a task with an image marker resolves one attachment', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'ad-')));
  await store.put(MediaKind.Image, new Uint8Array([1]), 'image/png');
  const parts = await resolveAttachments('see [img:img_1]', store);
  expect(parts.length).toBe(1);
});
```
(The end-to-end wiring is proven at live-verify; this task's unit test asserts the resolver is invoked — keep the deterministic assertion on `resolveAttachments`, and thread `mediaStore` through the signature.)

- [ ] **Step 2: Run — expect FAIL** if signature not yet threaded (typecheck fails on the new param at call sites).
- [ ] **Step 3: Implement** — thread `mediaStore?` param through `runDefinedAgent`; compute `attachments = mediaStore ? await resolveAttachments(task, mediaStore) : undefined`; pass to `runAgent`.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): runDefinedAgent resolves media handles for specialists"`

---

### Task A7: macOS clipboard image capture

**Files:**
- Create: `src/media/clipboard.ts`
- Test: `tests/media/clipboard.test.ts`

**Interfaces:**
- Produces: `export async function captureClipboardImage(deps?: { platform?: string; run?: (cmd: string, args: string[]) => Promise<{ ok: boolean; bytes?: Uint8Array }> }): Promise<{ bytes: Uint8Array; mediaType: string } | undefined>;`
- Returns `undefined` (graceful) off-mac or when the clipboard has no image.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { captureClipboardImage } from '../../src/media/clipboard.ts';

test('returns undefined off darwin', async () => {
  expect(await captureClipboardImage({ platform: 'linux' })).toBeUndefined();
});

test('returns png bytes when clipboard holds an image', async () => {
  const run = async () => ({ ok: true, bytes: new Uint8Array([137, 80, 78, 71]) });
  const got = await captureClipboardImage({ platform: 'darwin', run });
  expect(got?.mediaType).toBe('image/png');
  expect(Array.from(got!.bytes)).toEqual([137, 80, 78, 71]);
});

test('returns undefined when clipboard has no image', async () => {
  const run = async () => ({ ok: false });
  expect(await captureClipboardImage({ platform: 'darwin', run })).toBeUndefined();
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — default `platform = process.platform`; if `!== 'darwin'` return undefined. Default `run` shells `osascript -e 'the clipboard as «class PNGf»'` piped to a temp file (or uses `pngpaste` if present), returning bytes. On `!ok` return undefined. Keep the osascript specifics behind the injectable `run` so the unit test is deterministic; the real capture is exercised at live-verify.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): macOS clipboard image capture (graceful off-mac)"`

---

### Task A8: ingest — flags + path auto-detect + paste → stored media + rewritten prompt

**Files:**
- Create: `src/media/ingest.ts`
- Test: `tests/media/ingest.test.ts`

**Interfaces:**
- Consumes: `MediaStore` (A3), `captureClipboardImage` (A7), `transcribe` (A12 — optional dep, injected), `sampleFrames` (A13 — optional dep, injected), `MediaKind` (A2).
- Produces:
```ts
export type IngestFlags = { images: string[]; audios: string[]; videos: string[]; paste: boolean };
export type IngestResult = { prompt: string; items: MediaItem[] };
export async function ingestMedia(
  rawPrompt: string,
  flags: IngestFlags,
  store: MediaStore,
  deps?: { capturePaste?: typeof captureClipboardImage; transcribe?: (path: string) => Promise<string>; sampleFrames?: (path: string, store: MediaStore) => Promise<MediaItem>; exists?: (p: string) => boolean; mediaTypeOf?: (p: string) => string },
): Promise<IngestResult>;
```
Behavior: for each `--image` path → `store.putFile(Image)` + append ` [img:<handle>]` to prompt; each `--video` path → `sampleFrames` → append ` [video:<handle>]`; each `--audio` path → `transcribe` → append `\n\nTranscript:\n<text>` (audio becomes text, per D5 of spec); `--paste` → `capturePaste` → if bytes, `store.put(Image)` + ` [img:<handle>]`. Also auto-detect bare filesystem paths embedded in `rawPrompt` that `exists()` and have an image/audio/video mediaType, treating them like the matching flag (dragged-in paths).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { ingestMedia } from '../../src/media/ingest.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshStore() { return createMediaStore(mkdtempSync(join(tmpdir(), 'ing-'))); }

test('--image flag stores the file and appends an img marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'a.png'); writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia('what is this', { images: [p], audios: [], videos: [], paste: false }, freshStore());
  expect(res.prompt).toBe('what is this [img:img_1]');
  expect(res.items.length).toBe(1);
});

test('--audio is transcribed to text and spliced into the prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'a.wav'); writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia('summarize', { images: [], audios: [p], videos: [], paste: false }, freshStore(), {
    transcribe: async () => 'hello world',
  });
  expect(res.prompt).toContain('Transcript:');
  expect(res.prompt).toContain('hello world');
});

test('a dragged-in image path in the prompt is auto-detected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'b.jpg'); writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia(`describe ${p}`, { images: [], audios: [], videos: [], paste: false }, freshStore());
  expect(res.prompt).toContain('[img:img_1]');
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** per the Interfaces behavior. Default `exists = existsSync`, `mediaTypeOf` = extension map, `transcribe`/`sampleFrames`/`capturePaste` = the real ones (injectable). Auto-detect: split prompt on whitespace, for each token that `exists()` and has a media mediaType, treat as that kind and replace the token with the marker.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): ingest (flags + path auto-detect + paste)"`

---

### Task A9: chat.ts arg parsing + wiring

**Files:**
- Modify: `src/cli/chat.ts` (argv read ~121-126; run wiring)
- Test: `tests/media/chat-args.test.ts`

**Interfaces:**
- Consumes: `IngestFlags` (A8).
- Produces: `export function parseMediaArgs(argv: string[]): { positional: string[]; flags: IngestFlags };` (value-taking `--image/--audio/--video <path>`, repeatable; boolean `--paste`), mirroring `crew.ts` `parseArgs`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { parseMediaArgs } from '../../src/cli/chat.ts';

test('parses repeatable media flags and leaves positional intact', () => {
  const { positional, flags } = parseMediaArgs(['describe', 'these', '--image', 'a.png', '--image', 'b.png', '--paste']);
  expect(positional).toEqual(['describe', 'these']);
  expect(flags.images).toEqual(['a.png', 'b.png']);
  expect(flags.paste).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — add `parseMediaArgs` (loop: `--image/--audio/--video` consume next token into the array; `--paste` sets boolean; else positional). In `main()`, replace the raw `join` with `const { positional, flags } = parseMediaArgs(process.argv.slice(2)); const rawPrompt = positional.join(' ').trim();` then, after the run dir exists, build a `MediaStore` and call `ingestMedia(rawPrompt, flags, store, ...)` to get the final `task`. (The store/run-dir hookup is completed alongside the orchestrator call — thread the store into `runOrchestrator`/`onBeforeDelegate` so specialists get it.)
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): chat media flags (--image/--audio/--video/--paste)"`

---

### Task A10: vision model declaration + catalog entry

**Files:**
- Create: `models/qwen-vision.ts`
- Modify: `models/registry.ts` (`BOOTSTRAP`), `src/provisioning/catalog/snapshot.json`
- Test: `tests/media/vision-model.test.ts`

**Interfaces:**
- Consumes: `Capability` (A1), `ModelDeclaration` (`src/core/types.ts`).
- Produces: `export default qwenVision: ModelDeclaration` with `model: 'qwen2.5vl:7b'`, `runtime: RuntimeKind.Ollama`, `capabilities: [Capability.Vision]`, `role: 'vision analysis'`, footprint set. Added to `BOOTSTRAP`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import qwenVision from '../../models/qwen-vision.ts';
import { Capability } from '../../src/core/types.ts';
import { BOOTSTRAP } from '../../models/registry.ts';

test('vision model advertises Vision and is in BOOTSTRAP', () => {
  expect(qwenVision.model).toBe('qwen2.5vl:7b');
  expect(qwenVision.capabilities).toContain(Capability.Vision);
  expect(BOOTSTRAP).toContain(qwenVision);
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — model file mirroring `models/qwen-fast.ts`; add to `BOOTSTRAP` array; add a `snapshot.json` entry `{ provider:'ollama', model:'qwen2.5vl:7b', repo:'qwen2.5vl', params_billions:7, bytes_per_weight:0.6, file_size_bytes:6000000000, downloads:0, role:'vision analysis', capabilities:['vision'] }`.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint; `bun run docs:check` (new model, no new subsystem — should pass).
- [ ] **Step 5: Commit** — `git commit -m "feat(models): declare qwen2.5vl vision model + catalog entry"`

---

### Task A11: vision analysis specialist

**Files:**
- Create: `agents/vision.ts`
- Modify: `agents/index.ts` (imports + entries markers)
- Test: `tests/media/vision-agent.test.ts`

**Interfaces:**
- Consumes: `AgentFactory` (`agents/index.ts`), `qwenVision` (A10), `Capability`/`PreferPolicy`.
- Produces: `createVisionAgent(tools): Agent` with `name:'vision'`, `modelReq.requires:[Capability.Vision]`; registered as `AGENTS.vision`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { AGENTS, agentNames } from '../../agents/index.ts';
import { Capability } from '../../src/core/types.ts';

test('vision specialist is registered and requires Vision', () => {
  expect(agentNames()).toContain('vision');
  const agent = AGENTS.vision({});
  expect(agent.name).toBe('vision');
  expect(agent.modelReq?.requires).toContain(Capability.Vision);
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — `agents/vision.ts` mirroring `agents/file-qa.ts` (system prompt: "You describe and answer questions about images."; `modelDecl: qwenVision`, `model: createOllamaModel(qwenVision)`, `requires:[Capability.Vision]`); add import + `vision: createVisionAgent,` entry above the markers in `index.ts`.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(agents): vision analysis specialist"`

---

### Task A12: audio transcription (mlx-whisper)

**Files:**
- Create: `src/media/audio/transcribe.ts`
- Test: `tests/media/transcribe.test.ts`

**Interfaces:**
- Consumes: `SpawnFn`/`ChildHandle` (`src/runtime/process-supervisor.ts`).
- Produces: `export async function transcribe(audioPath: string, deps?: { spawn?: SpawnFn; readJson?: (p: string) => Promise<{ text: string }>; model?: string; outDir?: string }): Promise<string>;`
- Builds args `['-m','mlx_whisper', audioPath, '--model', model, '--output-dir', outDir, '--output-format','json']` and reads `<outDir>/<base>.json`.`text`. Degrades to whisper.cpp when mlx unavailable (documented; deferred impl detail behind `deps`).

- [ ] **Step 1: Write the failing test** — inject a fake spawn that immediately fires `onExit(0)` and a fake `readJson` returning `{text:'hi'}`; assert the transcript + the constructed args.

```ts
import { expect, test } from 'bun:test';
import { transcribe } from '../../src/media/audio/transcribe.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('spawns mlx_whisper and returns the transcript text', async () => {
  let seen: string[] = [];
  const spawn: SpawnFn = (_cmd, args) => { seen = args; return { pid: 1, kill() {}, onExit: (cb) => cb(0) }; };
  const text = await transcribe('/tmp/a.wav', { spawn, readJson: async () => ({ text: 'hi' }), model: 'whisper-large-v3-turbo', outDir: '/tmp/o' });
  expect(text).toBe('hi');
  expect(seen).toContain('--output-format');
  expect(seen).toContain('/tmp/a.wav');
});

test('rejects when the process exits non-zero', async () => {
  const spawn: SpawnFn = () => ({ pid: 1, kill() {}, onExit: (cb) => cb(1) });
  await expect(transcribe('/tmp/a.wav', { spawn, readJson: async () => ({ text: '' }) })).rejects.toThrow('transcription failed');
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — default `spawn` = `Bun.spawn` wrapper (the `process-supervisor` default `SpawnFn` shape); resolve on `onExit(0)` then read JSON; reject `Error('transcription failed (exit N)')` otherwise; default model from `process.env.AGENT_STT_MODEL ?? 'mlx-community/whisper-large-v3-turbo'`.
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): mlx-whisper transcription"`

---

### Task A13: video frame sampling (ffmpeg)

**Files:**
- Create: `src/media/video/frames.ts`
- Test: `tests/media/frames.test.ts`

**Interfaces:**
- Consumes: `SpawnFn`, `MediaStore` (A3).
- Produces:
```ts
export function buildFfmpegArgs(input: string, outPattern: string, opts: { fps: number; maxFrames: number; longEdge: number }): string[];
export async function sampleFrames(videoPath: string, store: MediaStore, deps?: { spawn?: SpawnFn; listFrames?: (dir: string) => string[]; fps?: number; maxFrames?: number; longEdge?: number }): Promise<MediaItem>;
```
`sampleFrames` samples frames to a temp dir, stores each as an Image, and returns ONE group `MediaItem` (kind `Video`, whose `path` is the frame dir) — resolver A4 expands a `[video:h]` to all frames in the group. (Group handling: store the frame handles list on the item; extend `resolve.ts` to expand video group handles into multiple parts.)

- [ ] **Step 1: Write the failing test** (arg builder is pure — test it directly):

```ts
import { expect, test } from 'bun:test';
import { buildFfmpegArgs } from '../../src/media/video/frames.ts';

test('ffmpeg args apply adaptive fps + scale', () => {
  const args = buildFfmpegArgs('/in.mp4', '/out/frame_%04d.jpg', { fps: 1, maxFrames: 30, longEdge: 768 });
  const vf = args[args.indexOf('-vf') + 1];
  expect(vf).toContain('fps=1');
  expect(vf).toContain('768');
  expect(args).toContain('/in.mp4');
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — `buildFfmpegArgs` → `['-i', input, '-vf', `fps=${fps},scale='min(${longEdge},iw)':-1`, '-frames:v', String(maxFrames), '-q:v', '3', outPattern]`; `sampleFrames` spawns ffmpeg, on exit-0 lists frames, `store.put(Image)` each, returns a group item. Adaptive fps by probed duration is a refinement noted for live-verify (default 1 fps).
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): ffmpeg frame sampling"`

---

### Task A14: analysis telemetry

**Files:**
- Modify: `src/telemetry/spans.ts` (`ATTR` object; add helpers)
- Test: `tests/media/telemetry-analysis.test.ts`

**Interfaces:**
- Produces: `ATTR.INPUT_MODALITY = 'gen_ai.input.modality'`; `withTranscribeSpan(info, fn)` (span `media.transcribe`, attrs model/audioSeconds/durationMs/outcome); `withFrameSampleSpan(info, fn)` (span `media.frames`, attrs fps/framesSampled/durationMs).

- [ ] **Step 1: Write the failing test** — assert the helpers run the body and return its value (span export is via OTel; a no-exporter run is a no-op but must not throw):

```ts
import { expect, test } from 'bun:test';
import { withTranscribeSpan, withFrameSampleSpan, ATTR } from '../../src/telemetry/spans.ts';

test('ATTR has media keys', () => {
  expect(ATTR.INPUT_MODALITY).toBe('gen_ai.input.modality');
});
test('span helpers run the body', async () => {
  expect(await withTranscribeSpan({ model: 'w', audioSeconds: 1 }, async () => 42)).toBe(42);
  expect(await withFrameSampleSpan({ fps: 1, framesSampled: 3 }, async () => 'ok')).toBe('ok');
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — add `INPUT_MODALITY`/`CONTENT_POLICY` keys to the `ATTR` `as const`; add `withTranscribeSpan`/`withFrameSampleSpan` following the `withProvisionSpan` pattern (seed attrs from info, wrap in `inSpan`).
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(telemetry): media analysis spans + modality attr"`

**PHASE A gate:** controller runs full `bun test` + typecheck + lint + docs:check. Then **live-verify A** (`MULTIMODAL_LIVE=1`): real image describe (qwen2.5vl), real STT (mlx-whisper), real video frames→describe. Log real timings.

---

# PHASE B — Image + Audio generation

### Task B1: MediaGenerator adapter — types + OneShot lifecycle

**Files:**
- Create: `src/media/generate/adapter.ts`
- Test: `tests/media/adapter-oneshot.test.ts`

**Interfaces:**
- Consumes: `SpawnFn`/`ChildHandle` (`process-supervisor.ts`), `JobHandle`/`JobStatus`/`FileHandle`/`ExecMode` (A2), `MediaStore` (A3).
- Produces:
```ts
export type GenStrategy = {
  kind: MediaKind; execMode: ExecMode;
  buildOneShot?(prompt: string, outPath: string, opts: GenOpts): { cmd: string; args: string[]; env?: Record<string,string> };
  parseProgress?(line: string): JobProgress | undefined;
  serverSubmit?(prompt: string, opts: GenOpts): Promise<{ poll(): Promise<JobProgress>; result(): Promise<string> }>;
};
export type GenOpts = { model?: string; width?: number; height?: number; seconds?: number; image?: string; disableSafetyChecker?: boolean };
export function runOneShotJob(strategy: GenStrategy, prompt: string, store: MediaStore, mediaType: string, opts: GenOpts, deps?: { spawn?: SpawnFn }): JobHandle;
```
`runOneShotJob` spawns `buildOneShot(...)`, streams stdout lines through `parseProgress` into the `progress` async iterable, on `onExit(0)` stores the produced file and `result()` resolves the `FileHandle`; `cancel()` = `kill('SIGTERM')` → status `Cancelled`; non-zero exit → status `Failed`, `result()` rejects.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { runOneShotJob } from '../../src/media/generate/adapter.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind, JobStatus } from '../../src/media/types.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('one-shot job writes output, resolves a file handle, completes', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  let outPath = '';
  const spawn: SpawnFn = (_cmd, args) => {
    outPath = args[args.indexOf('--output') + 1];
    writeFileSync(outPath, new Uint8Array([1, 2]));
    return { pid: 7, kill() {}, onExit: (cb) => cb(0) };
  };
  const strategy = { kind: MediaKind.Image, execMode: 'one_shot' as const,
    buildOneShot: (_p: string, out: string) => ({ cmd: 'mflux', args: ['--output', out] }) };
  const job = runOneShotJob(strategy, 'a fox', store, 'image/png', {}, { spawn });
  const fh = await job.result();
  expect(job.status()).toBe(JobStatus.Completed);
  expect(fh.sizeBytes).toBe(2);
});

test('non-zero exit -> Failed and result rejects', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const spawn: SpawnFn = () => ({ pid: 7, kill() {}, onExit: (cb) => cb(1) });
  const strategy = { kind: MediaKind.Image, execMode: 'one_shot' as const,
    buildOneShot: (_p: string, out: string) => ({ cmd: 'mflux', args: ['--output', out] }) };
  const job = runOneShotJob(strategy, 'x', store, 'image/png', {}, { spawn });
  await expect(job.result()).rejects.toThrow('generation failed');
  expect(job.status()).toBe(JobStatus.Failed);
});
```

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** `runOneShotJob` — allocate outPath in `store`'s media dir, spawn, wire `onExit`, `store.putFile` on success, expose `JobHandle`. Progress iterable backed by a queue fed from stdout lines (if the spawn provides them; the fake omits them → progress just yields terminal status).
- [ ] **Step 4: Run — expect PASS**; typecheck; lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): MediaGenerator one-shot job runner"`

---

### Task B2: image generator strategy (mflux)

**Files:**
- Create: `src/media/generate/image-mflux.ts`
- Test: `tests/media/image-mflux.test.ts`

**Interfaces:**
- Consumes: `GenStrategy`/`GenOpts` (B1).
- Produces: `export const mfluxStrategy: GenStrategy` with `buildOneShot(prompt, outPath, opts)` → `{ cmd:'mflux-generate', args:['--model', opts.model ?? 'schnell', '--steps','4','-q','8','--height',String(opts.height ?? 1024),'--width',String(opts.width ?? 1024),'--prompt',prompt,'--output',outPath] }`. (mflux has no safety checker → `disableSafetyChecker` is a documented no-op here.)

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { mfluxStrategy } from '../../src/media/generate/image-mflux.ts';

test('mflux args carry prompt, output, and default schnell model', () => {
  const spec = mfluxStrategy.buildOneShot!('a fox', '/out.png', {});
  expect(spec.cmd).toBe('mflux-generate');
  expect(spec.args).toContain('--prompt');
  expect(spec.args[spec.args.indexOf('--prompt') + 1]).toBe('a fox');
  expect(spec.args[spec.args.indexOf('--output') + 1]).toBe('/out.png');
  expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('schnell');
});
```

- [ ] **Step 2: Run — expect FAIL**. **Step 3: Implement** as above. **Step 4: PASS + typecheck + lint. Step 5: Commit** — `git commit -m "feat(media): mflux image generator strategy"`

---

### Task B3: audio generator strategy (mlx-audio / Kokoro)

**Files:**
- Create: `src/media/generate/audio-mlx.ts`
- Test: `tests/media/audio-mlx.test.ts`

**Interfaces:**
- Produces: `export const kokoroStrategy: GenStrategy` (kind `Audio`, one-shot) `buildOneShot(text, outPath, opts)` → `{ cmd:'mlx_audio.tts.generate', args:['--model', opts.model ?? 'mlx-community/Kokoro-82M-bf16','--text',text,'--voice', (opts as any).voice ?? 'af_heart','--output_path', outPath] }` (mediaType `audio/wav`).

- [ ] **Step 1: Write the failing test** — assert cmd + `--text` + `--output_path`. **Steps 2-4** as pattern. **Step 5: Commit** — `git commit -m "feat(media): Kokoro TTS generator strategy"`

---

### Task B4: generation tools + media_creator specialist

**Files:**
- Create: `src/media/generate/tools.ts`, `agents/media-creator.ts`
- Modify: `agents/index.ts`
- Test: `tests/media/generate-tools.test.ts`, `tests/media/media-creator-agent.test.ts`

**Interfaces:**
- Consumes: `runOneShotJob` (B1), `mfluxStrategy` (B2), `kokoroStrategy` (B3), `MediaStore` (A3), AI SDK `tool`/`z`.
- Produces:
```ts
export function createGenerateTools(store: MediaStore, deps?: { spawn?: SpawnFn }): ToolSet; // generate_image, generate_speech
export function createMediaCreatorAgent(tools: ToolSet): Agent; // name 'media_creator'
```
Each tool: `inputSchema: z.object({ prompt: z.string(), ... })`, `execute` runs the job and returns a text summary incl. the output path (a file handle string, never bytes).

- [ ] **Step 1: Write the failing test** — build tools with an injected spawn that writes a file; invoke `generate_image.execute({prompt:'x'})`; assert the returned string contains a path ending `.png`. Also assert `agentNames()` contains `media_creator` and it holds `generate_image`.
- [ ] **Step 2: FAIL. Step 3: Implement** the tools (AI SDK `tool({description, inputSchema, execute})`) + the specialist (mirrors `file-qa.ts`, `requires:[Capability.Tools]`, tools = the generate set); register `media_creator` in `index.ts`.
- [ ] **Step 4: PASS + typecheck + lint. Step 5: Commit** — `git commit -m "feat(media): generate tools + media_creator specialist"`

---

### Task B5: generation telemetry

**Files:** Modify `src/telemetry/spans.ts`; Test `tests/media/telemetry-generate.test.ts`
**Interfaces:** `withGenerateSpan(info, fn)` (span `media.generate`, attrs kind/engine/model/execMode/durationMs/sizeBytes/outcome).
- [ ] Steps mirror A14: failing test asserts helper runs body → implement following `withProvisionSpan` → PASS → commit `feat(telemetry): media.generate span`. Wire `withGenerateSpan` around `runOneShotJob`'s completion in B1 (small follow-up edit + test that a completed job records outcome).

**PHASE B gate:** full `bun test` + typecheck + lint. **Live-verify B** (`MULTIMODAL_LIVE=1`): real mflux image gen → PNG on disk; real Kokoro TTS → wav. Install `mflux` + `mlx-audio` into the venv first (consent-gated); log timings.

---

# PHASE C — Video generation

### Task C1: video generator strategy (mlx-video LTX) + progress parse

**Files:** Create `src/media/generate/video-mlx.ts`; Test `tests/media/video-mlx.test.ts`
**Interfaces:** `export const ltxStrategy: GenStrategy` (kind `Video`, one-shot, mediaType `video/mp4`): `buildOneShot(prompt, outPath, opts)` → `{ cmd:'mlx_video.ltx_2.generate', args:['--prompt',prompt, ...(opts.image?['--image',opts.image]:[]), '-n', String(opts.seconds?opts.seconds*24:97), '--width', String(opts.width ?? 768), '--output-path', outPath] }`; `parseProgress(line)` parses `step 12/50` → `{fraction:0.24, message:line}`.
- [ ] **Step 1: failing test** — assert args carry `--prompt`/`--output-path` and that `parseProgress('step 12/50')?.fraction` ≈ 0.24. **2-4** pattern. **5: Commit** — `feat(media): LTX video generator strategy + progress`

---

### Task C2: generate_video tool wired into media_creator

**Files:** Modify `src/media/generate/tools.ts`, `agents/media-creator.ts`; Test extend `tests/media/generate-tools.test.ts`
**Interfaces:** `createGenerateTools` also returns `generate_video` (async job; returns a summary with the output path once `result()` resolves; long-running — the tool awaits `job.result()` and surfaces progress via telemetry). Uses `ltxStrategy`.
- [ ] **Step 1: failing test** — injected spawn writes an `.mp4`; `generate_video.execute({prompt:'x'})` returns a string containing `.mp4`. **2-4** pattern. **5: Commit** — `feat(media): generate_video tool`

---

### Task C3: ComfyUI/Wan server-lane fallback (degrade)

**Files:** Modify `src/media/generate/adapter.ts` (server-mode via `superviseServer`); Create `src/media/generate/comfy-lane.ts`; Test `tests/media/adapter-server.test.ts`
**Interfaces:** `runServerJob(strategy, prompt, store, mediaType, opts, deps)` uses `serverSubmit` (POST /prompt → poll /history → GET /view); the adapter picks server-vs-oneshot by `strategy.execMode`; degrade: if a one-shot engine binary is absent (`Bun.which` null), fall back to the server lane for the same `MediaKind` (and vice-versa), emitting `DegradeKind` via the reliability ledger.
- [ ] **Step 1: failing test** — fake `serverSubmit` returning a poller that completes after 2 polls; assert `runServerJob` resolves a FileHandle. Also a degrade test: one-shot `which` returns null → adapter routes to server lane (assert the server path ran). **2-4** pattern. **5: Commit** — `feat(media): server-lane generation + one-shot<->server degrade`

**PHASE C gate:** full `bun test` + typecheck + lint. **Live-verify C** (`MULTIMODAL_LIVE=1`): install `mlx-video` (or ComfyUI+Wan) consent-gated; run ONE short clip; **capture true M4-Pro wall-clock**; verify it *runs* (not that it's fast). Progress + cancel exercised.

---

# PHASE D — Uncensored axis (default ON)

### Task D1: content-policy switch + eligibility predicate

**Files:** Create `src/media/policy.ts`; Test `tests/media/policy.test.ts`
**Interfaces:**
```ts
export function uncensoredEnabled(env?: Record<string,string|undefined>): boolean; // DEFAULT true; only 'AGENT_UNCENSORED=0'/'false' turns it off
export function isUncensoredModel(model: { model: string; contentPolicy?: ContentPolicy }): boolean; // predicate: contentPolicy===Uncensored OR name matches abliterated|dolphin|heretic|josiefied|pony|chroma (case-insensitive)
```
- [ ] **Step 1: failing test**

```ts
import { expect, test } from 'bun:test';
import { uncensoredEnabled, isUncensoredModel } from '../../src/media/policy.ts';
import { ContentPolicy } from '../../src/core/types.ts';

test('uncensored defaults ON, off only when explicitly disabled', () => {
  expect(uncensoredEnabled({})).toBe(true);
  expect(uncensoredEnabled({ AGENT_UNCENSORED: '0' })).toBe(false);
  expect(uncensoredEnabled({ AGENT_UNCENSORED: 'false' })).toBe(false);
});
test('predicate matches the abliterated class and the enum tag', () => {
  expect(isUncensoredModel({ model: 'goekdenizguelmez/JOSIEFIED-Qwen3:8b' })).toBe(true);
  expect(isUncensoredModel({ model: 'qwen3.5:9b' })).toBe(false);
  expect(isUncensoredModel({ model: 'x', contentPolicy: ContentPolicy.Uncensored })).toBe(true);
});
```
- [ ] **2: FAIL. 3: Implement** (regex `/(abliterat|dolphin|heretic|josiefied|pony|chroma|uncensored)/i`; default-on env read). **4: PASS + typecheck + lint. 5: Commit** — `feat(media): content-policy switch (default on) + eligibility predicate`

---

### Task D2: thread allowUncensored default-on into selection

**Files:** Modify `src/cli/select-hook.ts` (set `req.allowUncensored` from `uncensoredEnabled()` when building the requirement) — and any `modelReq` construction site that should honor it; Test `tests/media/uncensored-selection.test.ts`
**Interfaces:** Consumes `uncensoredEnabled` (D1). The selector filter `selector.ts:29` already gates on `req.allowUncensored`; this task ensures it's set to `true` by default (from the switch) so uncensored candidates are eligible everywhere.
- [ ] **Step 1: failing test** — build a small registry with one `ContentPolicy.Uncensored` candidate + one default; call `selectCandidates` (or `resolveModel`) with a requirement whose `allowUncensored` came from `uncensoredEnabled({})` (=true) → uncensored candidate is present; with `AGENT_UNCENSORED=0` → absent. **2: FAIL. 3: Implement** the thread-through. **4: PASS + typecheck + lint. 5: Commit** — `feat(select): uncensored eligible by default across flows`

---

### Task D3: uncensored model declarations + catalog entries

**Files:** Modify `src/provisioning/catalog/snapshot.json` (+ optionally `models/`); Create `models/uncensored/*` decls as needed; Test `tests/media/uncensored-catalog.test.ts`
**Interfaces:** Add catalog entries (each `contentPolicy` implied by the predicate or set explicitly) for: text `goekdenizguelmez/JOSIEFIED-Qwen3:8b` (`capabilities:['tools']`), vision `huihui_ai/qwen3-vl-abliterated:8b` (`capabilities:['vision']`). Image/video uncensored (Pony/Wan) are ComfyUI-lane weights — documented, pulled via the server lane, not the Ollama snapshot.
- [ ] **Step 1: failing test** — load snapshot; assert the two uncensored tags are present and match `isUncensoredModel`. **2: FAIL. 3: Implement** entries. **4: PASS + typecheck + lint + docs:check. 5: Commit** — `feat(catalog): uncensored text + vision model entries`

---

### Task D4: safety-checker-disable on the generation path

**Files:** Modify `src/media/generate/comfy-lane.ts` + `src/media/generate/adapter.ts`; Test `tests/media/safety-checker.test.ts`
**Interfaces:** `GenOpts.disableSafetyChecker` (default = `uncensoredEnabled()`). For the ComfyUI/Diffusers lane, when true, pass `safety_checker=None` / add no checker node. For mflux/mlx-audio/mlx-video it's a **documented no-op** (already filter-free). Add a `disableSafetyChecker()` helper that returns the workflow/flags fragment.
- [ ] **Step 1: failing test** — `buildDiffusersFlags({disableSafetyChecker:true})` includes `safety_checker=None`; `{disableSafetyChecker:false}` omits it; mflux strategy ignores it (no-op — assert its args unchanged either way). **2: FAIL. 3: Implement. 4: PASS + typecheck + lint. 5: Commit** — `feat(media): safety-checker disable on Diffusers/ComfyUI lane`

---

### Task D5: content_policy telemetry + labeling + voice-clone consent + legal copy

**Files:** Modify `src/telemetry/spans.ts` (set `ATTR.CONTENT_POLICY` on runs), `src/media/generate/tools.ts` (label outputs; voice-clone affirmation), `src/media/generate/audio-mlx.ts` (clone models behind consent); Create `src/media/consent.ts`; Test `tests/media/consent-label.test.ts`
**Interfaces:**
```ts
export function contentPolicyLabel(uncensored: boolean): string; // 'uncensored' | 'default'
export function requiresCloneConsent(model: string): boolean; // CSM/Dia/XTTS/Fish -> true; Kokoro -> false
export async function affirmCloneConsent(deps: { ask: (q: string) => Promise<boolean> }): Promise<boolean>;
export const LEGAL_NOTE: string; // "Filters removed does not remove legal obligations..."
```
- [ ] **Step 1: failing test** — `requiresCloneConsent('csm')===true`, `requiresCloneConsent('mlx-community/Kokoro-82M-bf16')===false`; `contentPolicyLabel(true)==='uncensored'`; `affirmCloneConsent({ask:async()=>false})===false`. **2: FAIL. 3: Implement.** The legal note is a string constant surfaced at pull/label — **no gate**. Voice-clone consent gates ONLY the cloning strategies, orthogonal to the content switch. **4: PASS + typecheck + lint. 5: Commit** — `feat(media): content-policy label + telemetry + voice-clone consent + legal note`

**PHASE D gate:** full `bun test` + typecheck + lint. **Live-verify D** (`MULTIMODAL_LIVE=1`): switch OFF (`AGENT_UNCENSORED=0`) → abliterated tag absent from selection + Diffusers keeps checker; switch ON (default) → tag selectable + Diffusers loads `safety_checker=None`; pull `JOSIEFIED-Qwen3:8b` + `huihui_ai/qwen3-vl-abliterated:8b` (consent) and confirm they run.

---

# PHASE E — Finalize (not TDD tasks; controller-run)

- [ ] **Docs (all 4 surfaces):** `docs/architecture.md` new **§22 Multimodal** + §4 axes row + §5 note; `README.md` status line + slice table row (✅) + feature paragraph; `docs/ROADMAP.md` flip Vision/Audio/Video (+ folded gen + uncensored) → ✅ Slice 27; regenerate the **Artifact** (new Multimodal node + edges, footer slice/test counts). Run `bun run docs:check`.
- [ ] **SDD ledger:** append per-task/review/fix/landing entries to `.superpowers/sdd/progress.md` throughout.
- [ ] **Whole-branch final review:** fan out reviewers (correctness / security incl. the uncensored copy-not-gate / docs-accuracy).
- [ ] **Live-verify edge cases** post-review: missing file, non-image as `--image`, huge video (frame cap), degrade when an engine absent, non-mac clipboard, FLUX-dev license flag at pull, voice-clone separate consent.
- [ ] **Merge** `--no-ff` to main + push (slice-landing gate: README + ROADMAP + ledger in the same push). Ask y/N before each git action.

---

## Self-review (against spec)

- **Spec coverage:** analyze (A1–A14: vision/STT/frames + routing + ingest), generate (B1–B5 image/audio, C1–C3 video), uncensored (D1–D5), model-choice-mirror (A10 catalog + D2/D3 selection + env pins referenced in A12/B2/B3/C1), telemetry (A14/B5/D5), docs (E). All spec §sections map to tasks. ✅
- **Media-by-reference** (spec D2): A4 resolver + A6 specialist rehydration + untouched delegate schema. ✅
- **Hardware-adaptive** (spec D3): media models are capability-tagged candidates via the existing selector (A10, D2/D3); no hardcoded ids (env pins are fallback-only). ✅
- **Type consistency:** `MediaFilePart` (A2) used by A4/A5; `JobHandle`/`GenStrategy`/`GenOpts` (A2/B1) used by B2–C2; `uncensoredEnabled`/`isUncensoredModel` (D1) used by D2–D5. Names consistent. ✅
- **Placeholder scan:** engine-integration tasks test via injected `SpawnFn` with real expected args; real-CLI output parsing is validated at each phase's live-verify (explicit, not a placeholder). ✅
- **Env pins** (`AGENT_{STT,IMAGE,VOICE,VIDEO,VISION}_MODEL`): referenced in A12 (STT), B2 (image via `opts.model`), B3 (voice), C1 (video); vision via the declared model + selector. Wire each strategy's default `model` from its env pin (fallback-only) during implementation.
