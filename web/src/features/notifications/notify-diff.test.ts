import type { RunListItemDTO } from '@contracts';
import { RunKind, RunLifecycle, RunOrigin } from '@contracts';
import { describe, expect, it } from 'vitest';
import { diffRunNotifications } from './notify-diff.ts';

function runItem(overrides: Partial<RunListItemDTO> = {}): RunListItemDTO {
  return {
    id: 'run-1',
    startMs: 0,
    durationMs: 0,
    outcome: 'answer',
    lifecycle: RunLifecycle.Running,
    origin: RunOrigin.Manual,
    kind: RunKind.Crew,
    models: [],
    degraded: false,
    spanCount: 0,
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

const MIN_DURATION_MS = 60_000;

describe('diffRunNotifications', () => {
  it('(a) the baseline poll never notifies, regardless of what it finds', () => {
    const items = [
      runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 999_999 }),
      runItem({
        id: 'r2',
        lifecycle: RunLifecycle.Failed,
        durationMs: 999_999,
      }),
    ];
    const { toNotify, nextSeen } = diffRunNotifications(new Map(), items, {
      baseline: true,
      minDurationMs: MIN_DURATION_MS,
    });
    expect(toNotify).toEqual([]);
    expect(nextSeen.get('r1')).toBe(RunLifecycle.Done);
    expect(nextSeen.get('r2')).toBe(RunLifecycle.Failed);
  });

  it('fires exactly once for a Running->Done transition past the duration threshold', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 90_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([
      { runId: 'r1', kind: RunKind.Crew, durationMs: 90_000 },
    ]);
  });

  it('never fires when durationMs does not exceed the threshold', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 1_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([]);
  });

  it('(d) never fires for a real post-fix chat run (kind=Chat), even past the duration threshold', () => {
    // Post-fix reality: a chat turn opens a `chat.run` root, which
    // `deriveRunKind(['chat.run'])` genuinely classifies as `RunKind.Chat`
    // (proven engine-side by the run-kind / run-dto tests). This is NOT the
    // pre-fix accident where chat rooted an `agent.run` span and only escaped
    // notification because its kind happened not to match — chat now simply
    // is not a notifiable kind. Seed Running, poll Done over-threshold, assert
    // no toast queued.
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [
        runItem({
          id: 'r1',
          kind: RunKind.Chat,
          lifecycle: RunLifecycle.Done,
          durationMs: 999_999,
        }),
      ],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([]);
  });

  it('(c) pins the notifiable-kind set: Crew/Workflow/Agent queue a Running->Done over-threshold run, Chat/Build/Pull/Mcp/Memory never do — any edit to NOTIFIABLE_KINDS trips this', () => {
    const notifiable = [RunKind.Crew, RunKind.Workflow, RunKind.Agent];
    const nonNotifiable = [
      RunKind.Chat,
      RunKind.Build,
      RunKind.Pull,
      RunKind.Mcp,
      RunKind.Memory,
    ];
    // Every kind currently in NOTIFIABLE_KINDS must queue.
    for (const kind of notifiable) {
      const { toNotify } = diffRunNotifications(
        new Map([['r1', RunLifecycle.Running]]),
        [
          runItem({
            id: 'r1',
            kind,
            lifecycle: RunLifecycle.Done,
            durationMs: 999_999,
          }),
        ],
        { baseline: false, minDurationMs: MIN_DURATION_MS },
      );
      expect(toNotify).toEqual([{ runId: 'r1', kind, durationMs: 999_999 }]);
    }
    // Every other kind — Chat foremost — must NOT queue, byte-for-byte pinning
    // the set to {Crew, Workflow, Agent}. Adding/removing a kind flips one of
    // these assertions.
    for (const kind of nonNotifiable) {
      const { toNotify } = diffRunNotifications(
        new Map([['r1', RunLifecycle.Running]]),
        [
          runItem({
            id: 'r1',
            kind,
            lifecycle: RunLifecycle.Done,
            durationMs: 999_999,
          }),
        ],
        { baseline: false, minDurationMs: MIN_DURATION_MS },
      );
      expect(toNotify).toEqual([]);
    }
  });

  it('(b) a run already terminal at baseline never fires later — the check is Running->terminal specifically, not "terminal now"', () => {
    // Baseline poll sees the run already Done.
    const baselineResult = diffRunNotifications(
      new Map(),
      [
        runItem({
          id: 'r1',
          lifecycle: RunLifecycle.Done,
          durationMs: 999_999,
        }),
      ],
      { baseline: true, minDurationMs: MIN_DURATION_MS },
    );
    expect(baselineResult.toNotify).toEqual([]);
    // A later poll sees the SAME still-Done run — must not fire, because the
    // seen-map already recorded Done (never Running) for this run.
    const laterResult = diffRunNotifications(
      baselineResult.nextSeen,
      [
        runItem({
          id: 'r1',
          lifecycle: RunLifecycle.Done,
          durationMs: 999_999,
        }),
      ],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(laterResult.toNotify).toEqual([]);
  });

  it('a Queued/Paused->terminal transition that skips an observed Running state never fires', () => {
    const seen = new Map([['r1', RunLifecycle.Queued]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [
        runItem({
          id: 'r1',
          lifecycle: RunLifecycle.Done,
          durationMs: 999_999,
        }),
      ],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([]);
  });

  it('dedup falls out of the map: firing once updates the seen state to terminal, so a repeat poll of the same terminal run never re-fires', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const first = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 90_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(first.toNotify).toHaveLength(1);
    const second = diffRunNotifications(
      first.nextSeen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 90_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(second.toNotify).toEqual([]);
  });

  it('(c) never drops or forgets a runId already in the map, even across an unrelated poll with a different set of items', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { nextSeen } = diffRunNotifications(
      seen,
      [runItem({ id: 'r2', lifecycle: RunLifecycle.Running })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(nextSeen.get('r1')).toBe(RunLifecycle.Running);
    expect(nextSeen.get('r2')).toBe(RunLifecycle.Running);
  });
});
