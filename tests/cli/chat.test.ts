import { describe, expect, it } from 'bun:test';
import { warnUnknownChatAgents } from '../../src/cli/chat.ts';
import { McpTransportKind } from '../../src/mcp/types.ts';

const entry = (name: string, agents?: string[]) => ({
  kind: McpTransportKind.Stdio as const,
  name,
  command: 'fake',
  args: [],
  env: {},
  agents,
  raw: { command: 'fake' },
});

describe('warnUnknownChatAgents', () => {
  it('warns when mcp.json targets an agent name outside the registry', () => {
    const warnings: string[] = [];
    warnUnknownChatAgents(
      {
        entries: [entry('a', ['file_qa', 'typo_agent'])],
        dormant: [],
        warnings: [],
      },
      (m) => warnings.push(m),
    );
    expect(warnings.some((w) => w.includes('typo_agent'))).toBe(true);
  });

  it('does not warn when every targeted agent name is registered', () => {
    const warnings: string[] = [];
    warnUnknownChatAgents(
      {
        entries: [entry('a', ['file_qa', 'web_fetch'])],
        dormant: [],
        warnings: [],
      },
      (m) => warnings.push(m),
    );
    expect(warnings).toEqual([]);
  });
});
