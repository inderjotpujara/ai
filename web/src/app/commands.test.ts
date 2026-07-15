import { describe, expect, it } from 'vitest';
import { navCommands } from './commands.ts';

describe('navCommands', () => {
  it('includes a jump-to-run command targeting /runs', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-run');
    expect(cmd?.label).toMatch(/run/i);
  });
});
