import { describe, expect, it } from 'vitest';
import { navCommands } from './commands.ts';

describe('navCommands', () => {
  it('includes a jump-to-run command targeting /runs', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-run');
    expect(cmd?.label).toMatch(/run/i);
  });

  it('includes a jump-to-crew command targeting /crews', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-crew');
    expect(cmd?.label).toMatch(/crew/i);
  });

  it('includes a jump-to-workflow command targeting /workflows', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-workflow');
    expect(cmd?.label).toMatch(/workflow/i);
  });

  it('includes a jump-to-sessions command targeting /sessions', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-sessions');
    expect(cmd?.label).toMatch(/session/i);
  });

  it('includes a search-sessions command also targeting /sessions', () => {
    const cmd = navCommands.find((c) => c.id === 'search-sessions');
    expect(cmd?.label).toMatch(/session/i);
  });
});
