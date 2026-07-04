import { describe, expect, test } from 'bun:test';
import { parseArgs as parseAgentBuilderArgs } from '../../src/cli/agent-builder.ts';
import { parseArgs as parseCrewBuilderArgs } from '../../src/cli/crew-builder.ts';

describe('agent-builder CLI args', () => {
  test('--force is parsed and removed from the need', () => {
    const parsed = parseAgentBuilderArgs(['summarize', 'urls', '--force']);
    expect(parsed).toEqual({
      need: 'summarize urls',
      autoYes: false,
      force: true,
    });
  });

  test('--yes/-y and --force combine; neither leaks into the need', () => {
    const parsed = parseAgentBuilderArgs(['-y', '--force', 'do', 'a', 'thing']);
    expect(parsed).toEqual({ need: 'do a thing', autoYes: true, force: true });
  });

  test('force defaults to false', () => {
    const parsed = parseAgentBuilderArgs(['just', 'a', 'need']);
    expect(parsed).toEqual({
      need: 'just a need',
      autoYes: false,
      force: false,
    });
  });
});

describe('crew-builder CLI args', () => {
  test('--force is parsed and removed from the need', () => {
    const parsed = parseCrewBuilderArgs([
      'research',
      'then',
      'write',
      '--force',
    ]);
    expect(parsed).toEqual({
      need: 'research then write',
      autoYes: false,
      force: true,
    });
  });

  test('--yes and --force combine', () => {
    const parsed = parseCrewBuilderArgs(['--yes', '--force', 'need']);
    expect(parsed).toEqual({ need: 'need', autoYes: true, force: true });
  });

  test('force defaults to false', () => {
    const parsed = parseCrewBuilderArgs(['need']);
    expect(parsed).toEqual({ need: 'need', autoYes: false, force: false });
  });
});
