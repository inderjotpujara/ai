import { describe, expect, it, vi } from 'vitest';
import { CommandKind, commands, runCommand } from './commands.ts';

describe('navCommands', () => {
  it('includes a jump-to-run command targeting /runs', () => {
    const cmd = commands.find((c) => c.id === 'jump-to-run');
    expect(cmd?.label).toMatch(/run/i);
  });

  it('includes a jump-to-crew command targeting /crews', () => {
    const cmd = commands.find((c) => c.id === 'jump-to-crew');
    expect(cmd?.label).toMatch(/crew/i);
  });

  it('includes a jump-to-workflow command targeting /workflows', () => {
    const cmd = commands.find((c) => c.id === 'jump-to-workflow');
    expect(cmd?.label).toMatch(/workflow/i);
  });

  it('includes a jump-to-sessions command targeting /sessions', () => {
    const cmd = commands.find((c) => c.id === 'jump-to-sessions');
    expect(cmd?.label).toMatch(/session/i);
  });

  it('includes a search-sessions command also targeting /sessions', () => {
    const cmd = commands.find((c) => c.id === 'search-sessions');
    expect(cmd?.label).toMatch(/session/i);
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
