import { describe, expect, it, spyOn } from 'bun:test';
import {
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
import type { RunHandle } from '../../src/run/run-store.ts';

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
});
