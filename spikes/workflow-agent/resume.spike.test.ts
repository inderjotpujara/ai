import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const STORE = 'spikes/workflow-agent/.wf-store';
const LOG = 'spikes/workflow-agent/.wf-store/nodes.log';

// The worker runs a 3-node DAG (a → b → c). Each node appends its name to LOG.
// Node b sleeps long enough that we kill the worker mid-b on the FIRST run,
// then re-run against the SAME store: a durable substrate resumes at b/c and
// must NOT re-append "a".
test('WorkflowAgent resumes mid-DAG from a filesystem store with no re-execution', () => {
  rmSync(STORE, { recursive: true, force: true });

  // Run 1: KILL after node "a" completes but before "c" finishes.
  const first = spawnSync(
    'bun',
    ['spikes/workflow-agent/worker.ts', '--kill-after', 'a'],
    {
      env: { ...process.env, WF_STORE: STORE, WF_LOG: LOG },
      timeout: 30_000,
    },
  );
  expect(first.status).not.toBe(0); // killed mid-run
  expect(existsSync(LOG)).toBe(true);
  const afterKill = readFileSync(LOG, 'utf8').trim().split('\n');
  expect(afterKill).toContain('a');
  expect(afterKill).not.toContain('c'); // did not finish

  // Run 2: resume against the SAME store — must finish c WITHOUT re-running a.
  const second = spawnSync(
    'bun',
    ['spikes/workflow-agent/worker.ts', '--resume'],
    {
      env: { ...process.env, WF_STORE: STORE, WF_LOG: LOG },
      timeout: 30_000,
    },
  );
  expect(second.status).toBe(0);
  const finalLog = readFileSync(LOG, 'utf8').trim().split('\n');
  expect(finalLog).toContain('c'); // completed
  // The KEY assertion: "a" appears EXACTLY ONCE across both runs (no re-exec).
  expect(finalLog.filter((l) => l === 'a')).toHaveLength(1);
});
