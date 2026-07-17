import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAT_MEMORY_SPACE,
  type ChatSessionDeps,
  runChatSession,
} from '../../src/cli/run-chat-session.ts';
import {
  type StatusEvent,
  StatusEventType,
} from '../../src/contracts/index.ts';
import type { BeforeDelegate } from '../../src/core/delegate.ts';
import type { OrchestratorResult } from '../../src/core/orchestrator.ts';
import type { ResourceCapture } from '../../src/core/resource-capture.ts';
import type { MountedRegistry } from '../../src/mcp/mount.ts';
import type { MediaStore } from '../../src/media/store.ts';
import type { MediaItem, MediaKind } from '../../src/media/types.ts';
import type { MemoryStore } from '../../src/memory/store.ts';
import type { RunHandle } from '../../src/run/run-store.ts';

/** A MediaStore that records the src paths handed to `putFile`, so a test can
 *  assert whether the prompt-text auto-detect ingested a given path. */
function recordingStore(): {
  store: MediaStore;
  putFilePaths: string[];
} {
  const putFilePaths: string[] = [];
  let n = 0;
  const store = {
    putFile: async (
      kind: MediaKind,
      srcPath: string,
      mediaType: string,
    ): Promise<MediaItem> => {
      putFilePaths.push(srcPath);
      n += 1;
      return { handle: `img_${n}`, kind, path: srcPath, mediaType };
    },
  } as unknown as MediaStore;
  return { store, putFilePaths };
}

const NO_MEDIA_FLAGS = {
  images: [],
  audios: [],
  videos: [],
  paste: false,
  voice: false,
  voiceIn: [],
};

function fakeDeps(overrides: Partial<ChatSessionDeps> = {}): ChatSessionDeps {
  const registry = { forAgent: () => ({}) } as unknown as MountedRegistry;
  const selectHook: BeforeDelegate = async () => ({});
  const capture: ResourceCapture = {};
  const run: RunHandle = { id: 'r1', dir: '/tmp/does-not-matter' };
  const mediaStore = {} as unknown as MediaStore;
  return {
    registry,
    selectHook,
    capture,
    run,
    mediaStore,
    ...overrides,
  };
}

describe('runChatSession', () => {
  it('returns the scripted result and no warnings when no media is given', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const runChatImpl = async () => scripted;
    const result = await runChatSession({
      task: 'say hi',
      deps: fakeDeps({ runChatImpl }),
    });
    expect(result).toEqual({ result: scripted, warnings: [], task: 'say hi' });
    // With no media, the returned task is the input task unchanged.
    expect(result.task).toBe('say hi');
  });

  it('emits RunStart then RunEnd on the events sink, in order', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const runChatImpl = async () => scripted;
    const seen: StatusEvent[] = [];
    await runChatSession({
      task: 'say hi',
      events: (e) => seen.push(e),
      deps: fakeDeps({ runChatImpl }),
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      type: StatusEventType.RunStart,
      runId: 'r1',
      task: 'say hi',
    });
    expect(seen[1]).toEqual({
      type: StatusEventType.RunEnd,
      runId: 'r1',
      outcome: 'answer',
    });
  });

  it('never touches console.log or console.error (CLI/server parity)', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const runChatImpl = async () => scripted;
    const logSpy = spyOn(console, 'log');
    const errorSpy = spyOn(console, 'error');
    try {
      await runChatSession({
        task: 'say hi',
        deps: fakeDeps({ runChatImpl }),
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('with no memoryStore configured, the task is unchanged (existing behavior, no recall)', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const result = await runChatSession({
      task: 'what did we discuss last time?',
      deps: fakeDeps({ runChatImpl: async () => scripted }),
    });
    expect(result.task).toBe('what did we discuss last time?');
  });

  it('with a memoryStore configured, injectRecall prepends recalled context to the task (space="chat")', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const recallCalls: { query: string; opts: { space?: string } }[] = [];
    const fakeMemoryStore = {
      recall: async (query: string, opts: { space?: string }) => {
        recallCalls.push({ query, opts });
        return [
          {
            id: 'd#0',
            source: 'chat:sess-1:m1',
            text: 'we discussed cats',
            score: 1,
            namespace: '',
          },
        ];
      },
    } as unknown as MemoryStore;
    const result = await runChatSession({
      task: 'what did we discuss last time?',
      deps: fakeDeps({
        runChatImpl: async () => scripted,
        memoryStore: fakeMemoryStore,
      }),
    });
    expect(result.task).toContain('we discussed cats');
    expect(result.task).toContain('what did we discuss last time?');
    expect(recallCalls).toHaveLength(1);
    expect(recallCalls[0]?.opts.space).toBe('chat');
  });

  it('CHAT_MEMORY_SPACE is the literal "chat" (the single source of truth handler.ts must match, T30)', () => {
    expect(CHAT_MEMORY_SPACE).toBe('chat');
  });

  // D17 (server path): the task text is attacker-controlled over HTTP, so the
  // prompt-text filesystem auto-detect MUST be disabled server-side, else an
  // attacker could name any readable host path with a media extension and have
  // its bytes read into the model. The server passes `ingestDeps.exists =
  // () => false`; these two tests prove that gate closes the hole (and that,
  // left on, the CLI's trusted path still auto-detects — the failing-before
  // condition).
  it('DOES auto-detect a real path in the task text when auto-detect is enabled (CLI/default)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autodetect-on-'));
    const secret = join(dir, 'secret.png');
    writeFileSync(secret, 'PNGBYTES');
    const { store, putFilePaths } = recordingStore();
    try {
      const scripted: OrchestratorResult = { kind: 'answer', text: 'ok' };
      const out = await runChatSession({
        task: `please read ${secret}`,
        media: NO_MEDIA_FLAGS,
        // ingestDeps left undefined → `exists` defaults to existsSync → the
        // real temp file IS detected and ingested.
        deps: fakeDeps({
          runChatImpl: async () => scripted,
          mediaStore: store,
        }),
      });
      expect(putFilePaths).toContain(secret);
      expect(out.task).toContain('[img:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT auto-detect a real path in the task text when auto-detect is disabled (server path, ingestDeps.exists = () => false)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autodetect-off-'));
    const secret = join(dir, 'secret.png');
    writeFileSync(secret, 'PNGBYTES');
    const { store, putFilePaths } = recordingStore();
    try {
      const scripted: OrchestratorResult = { kind: 'answer', text: 'ok' };
      const out = await runChatSession({
        task: `please read ${secret}`,
        media: NO_MEDIA_FLAGS,
        ingestDeps: { exists: () => false },
        deps: fakeDeps({
          runChatImpl: async () => scripted,
          mediaStore: store,
        }),
      });
      // The hole is closed: the host file was NEVER read/ingested, and no
      // marker was spliced in — the path is left inert in the task text.
      expect(putFilePaths).not.toContain(secret);
      expect(putFilePaths).toHaveLength(0);
      expect(out.task).not.toContain('[img:');
      expect(out.task).toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
