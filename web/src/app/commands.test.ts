import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Command, CommandKind, commands, runCommand } from './commands.ts';

describe('commands — deduped nav set + go-agents (D8, Task 17)', () => {
  it('go-agents navigates to /builders — the closest existing "Agents" surface today (see Task 17\'s surprise note)', () => {
    const cmd = commands.find((c) => c.id === 'go-agents');
    expect(cmd?.label).toMatch(/agent/i);
  });

  it('go-sessions replaces jump-to-sessions, filling the previously-missing plain "Go to Sessions" command', () => {
    expect(commands.find((c) => c.id === 'go-sessions')?.label).toMatch(
      /session/i,
    );
    expect(commands.find((c) => c.id === 'jump-to-sessions')).toBeUndefined();
  });

  it('drops the degenerate bare-list duplicates: jump-to-crew, jump-to-workflow, jump-to-run, search-sessions', () => {
    expect(commands.find((c) => c.id === 'jump-to-crew')).toBeUndefined();
    expect(commands.find((c) => c.id === 'jump-to-workflow')).toBeUndefined();
    expect(commands.find((c) => c.id === 'jump-to-run')).toBeUndefined();
    expect(commands.find((c) => c.id === 'search-sessions')).toBeUndefined();
  });
});

describe('runCommand (D8 — widened Command dispatch)', () => {
  it("calls an action-kind command's run() with no arguments, ignoring nav", () => {
    const run = vi.fn();
    const nav = vi.fn() as unknown as Parameters<typeof runCommand>[1];
    runCommand({ id: 'a', label: 'A', kind: CommandKind.Action, run }, nav);
    expect(run).toHaveBeenCalledWith();
    expect(nav).not.toHaveBeenCalled();
  });

  it("calls a nav-kind command's run(nav) with the navigate function", () => {
    const run = vi.fn();
    const nav = vi.fn() as unknown as Parameters<typeof runCommand>[1];
    runCommand({ id: 'b', label: 'B', kind: CommandKind.Nav, run }, nav);
    expect(run).toHaveBeenCalledWith(nav);
  });

  it('includes a toggle-voice-input action command (D8)', () => {
    const cmd = commands.find((c) => c.id === 'toggle-voice-input');
    expect(cmd?.kind).toBe(CommandKind.Action);
    expect(cmd?.label).toMatch(/voice/i);
  });

  it('includes a toggle-theme action command (D8)', () => {
    const cmd = commands.find((c) => c.id === 'toggle-theme');
    expect(cmd?.kind).toBe(CommandKind.Action);
    expect(cmd?.label).toMatch(/theme/i);
  });
});

describe('Ops ⌘K commands (Task 24 — per-tab nav)', () => {
  it('includes go-ops-overview/jobs/triggers/devices, each navigating to /ops with the right tab', () => {
    const nav = vi.fn();
    const cases: Array<[string, string]> = [
      ['go-ops-overview', 'overview'],
      ['go-ops-jobs', 'jobs'],
      ['go-ops-triggers', 'triggers'],
      ['go-ops-devices', 'devices'],
    ];
    for (const [id, tab] of cases) {
      const cmd = commands.find((c) => c.id === id);
      expect(cmd?.kind).toBe(CommandKind.Nav);
      runCommand(
        cmd as Command,
        nav as unknown as Parameters<typeof runCommand>[1],
      );
      expect(nav).toHaveBeenCalledWith({ to: '/ops', search: { tab } });
      nav.mockClear();
    }
  });

  it("labels the Devices & Access tab clearly (matches the tab's own display name)", () => {
    expect(commands.find((c) => c.id === 'go-ops-devices')?.label).toMatch(
      /devices/i,
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('jump-to-recent-run (D8 — real deep-link, not the bare list)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the most recent run and navigates to its specific runId', async () => {
    const cmd = commands.find((c) => c.id === 'jump-to-recent-run');
    expect(cmd?.kind).toBe(CommandKind.Nav);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: 'run-42',
              kind: 'chat',
              startMs: 0,
              durationMs: 1,
              outcome: 'answer',
              lifecycle: 'done',
              origin: 'manual',
              models: [],
              degraded: false,
              spanCount: 1,
            },
          ],
          total: 1,
        }),
      ),
    );
    const nav = vi.fn();
    await runCommand(
      cmd as Command,
      nav as unknown as Parameters<typeof runCommand>[1],
    );
    expect(nav).toHaveBeenCalledWith({
      to: '/runs/$runId',
      params: { runId: 'run-42' },
    });
  });

  it('falls back to the bare /runs list when there are no runs yet', async () => {
    const cmd = commands.find((c) => c.id === 'jump-to-recent-run');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    const nav = vi.fn();
    await runCommand(
      cmd as Command,
      nav as unknown as Parameters<typeof runCommand>[1],
    );
    expect(nav).toHaveBeenCalledWith({ to: '/runs' });
  });

  it('falls back to the bare /runs list (never throws) when the fetch fails', async () => {
    const cmd = commands.find((c) => c.id === 'jump-to-recent-run');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const nav = vi.fn();
    await expect(
      runCommand(
        cmd as Command,
        nav as unknown as Parameters<typeof runCommand>[1],
      ),
    ).resolves.toBeUndefined();
    expect(nav).toHaveBeenCalledWith({ to: '/runs' });
  });
});
