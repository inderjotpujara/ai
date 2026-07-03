import { describe, expect, it } from 'bun:test';
import {
  maybeAutoProvision,
  warnUnknownChatAgents,
} from '../../src/cli/chat.ts';
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

describe('maybeAutoProvision', () => {
  it('stderr-is-TTY but stdin-is-not (cmd < /dev/null) skips without detecting or asking', async () => {
    // Regression guard: judging TTY-ness off `process.stderr.isTTY` alone (the
    // old, buggy wiring) would read true here and proceed to detect/prompt —
    // which can hang or prompt into the void when stdin is closed. The fix
    // (interactiveTTY(), mirroring the MCP-consent path) requires BOTH stdin
    // and stderr to be TTYs, so this must skip before touching either dep.
    const stdinDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      'isTTY',
    );
    const stderrDescriptor = Object.getOwnPropertyDescriptor(
      process.stderr,
      'isTTY',
    );
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stderr, 'isTTY', {
      value: true,
      configurable: true,
    });
    try {
      let detectCalls = 0;
      let askCalls = 0;
      await maybeAutoProvision({
        // Deliberately omit isTTY so chat.ts's own `interactiveTTY()` wiring
        // is what gets exercised.
        detectMissing: async () => {
          detectCalls += 1;
          return [];
        },
        askYesNo: async () => {
          askCalls += 1;
          return true;
        },
      });
      expect(detectCalls).toBe(0);
      expect(askCalls).toBe(0);
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
      }
      if (stderrDescriptor) {
        Object.defineProperty(process.stderr, 'isTTY', stderrDescriptor);
      }
    }
  });

  it('does nothing when isTTY is explicitly false, regardless of real streams', async () => {
    let detectCalls = 0;
    await maybeAutoProvision({
      isTTY: false,
      detectMissing: async () => {
        detectCalls += 1;
        return [];
      },
    });
    expect(detectCalls).toBe(0);
  });
});
