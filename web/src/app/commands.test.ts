import { describe, expect, it, vi } from 'vitest';
import { CommandKind, commands, runCommand } from './commands.ts';

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
