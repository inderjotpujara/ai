import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import { DegradeKind } from '../../src/reliability/ledger.ts';

describe('withMcpRun degradation ledger', () => {
  it('exposes a ledger and persists it when events were recorded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runs-'));
    let runDir = '';
    await withMcpRun(
      {
        runsRoot: root,
        runId: 'r1',
        config: { entries: [], dormant: [], warnings: [] },
      },
      async (ctx) => {
        runDir = ctx.run.dir;
        ctx.ledger.record({
          kind: DegradeKind.AgentDropped,
          subject: 'a',
          reason: 'down',
        });
      },
    );
    const text = await readFile(join(runDir, 'degradation.jsonl'), 'utf8');
    expect(JSON.parse(text.trim()).subject).toBe('a');
  });
});
