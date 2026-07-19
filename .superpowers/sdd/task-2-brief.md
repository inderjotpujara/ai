## Task 2: Spike test — multi-node workflow killed mid-DAG resumes from last completed node

**Files:**
- Create: `spikes/workflow-agent/resume.spike.test.ts`
- Create: `spikes/workflow-agent/worker.ts` (the runnable multi-node workflow the test spawns, kills, and restarts)

**Interfaces:**
- Consumes: `@ai-sdk/workflow` `WorkflowAgent` + its filesystem store (Task 1); `newRunId` shape (a stable checkpoint key). Use a **fake/deterministic step body** (no real model) — each node appends its name to a side-effect log file and sleeps; killing the process between nodes must leave the completed-node log intact and, on restart against the SAME store dir, the workflow must NOT re-append a completed node's name.
- Produces: the empirical answer to §7.2, consumed by Task 3.

- [ ] **Step 1: Write the failing spike test**

`spikes/workflow-agent/resume.spike.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const STORE = 'spikes/workflow-agent/.wf-store';
const LOG = 'spikes/workflow-agent/.wf-store/nodes.log';

// The worker runs a 3-node DAG (a → b → c). Each node appends its name to LOG.
// Node b sleeps long enough that we kill the worker mid-b on the FIRST run,
// then re-run against the SAME store: a durable substrate resumes at b/c and
// must NOT re-append "a".
test('WorkflowAgent resumes mid-DAG from a filesystem store with no re-execution', () => {
  rmSync(STORE, { recursive: true, force: true });

  // Run 1: KILL after node "a" completes but before "c" finishes.
  const first = spawnSync('bun', ['spikes/workflow-agent/worker.ts', '--kill-after', 'a'], {
    env: { ...process.env, WF_STORE: STORE, WF_LOG: LOG },
    timeout: 30_000,
  });
  expect(first.status).not.toBe(0); // killed mid-run
  expect(existsSync(LOG)).toBe(true);
  const afterKill = readFileSync(LOG, 'utf8').trim().split('\n');
  expect(afterKill).toContain('a');
  expect(afterKill).not.toContain('c'); // did not finish

  // Run 2: resume against the SAME store — must finish c WITHOUT re-running a.
  const second = spawnSync('bun', ['spikes/workflow-agent/worker.ts', '--resume'], {
    env: { ...process.env, WF_STORE: STORE, WF_LOG: LOG },
    timeout: 30_000,
  });
  expect(second.status).toBe(0);
  const finalLog = readFileSync(LOG, 'utf8').trim().split('\n');
  expect(finalLog).toContain('c'); // completed
  // The KEY assertion: "a" appears EXACTLY ONCE across both runs (no re-exec).
  expect(finalLog.filter((l) => l === 'a')).toHaveLength(1);
});
```

- [ ] **Step 2: Run the spike — record the real behaviour**

```bash
rm -rf spikes/workflow-agent/.wf-store
bun test spikes/workflow-agent/resume.spike.test.ts
```
- If it PASSES → `WorkflowAgent` + filesystem store resumes cleanly local-first → **adopt path is viable**.
- If `WorkflowAgent`'s API cannot express a filesystem store without Vercel infra, or re-executes node `a` on resume, or the peer range blocked install (Task 1) → **adopt path is not viable**; the custom checkpoint fallback is selected.

Either way is a valid outcome — this task's deliverable is the recorded truth, not a green test.

- [ ] **Step 3: Implement `worker.ts` to exercise the real API**

`spikes/workflow-agent/worker.ts` — build the smallest 3-node `WorkflowAgent` the installed API supports, configured with a filesystem store rooted at `process.env.WF_STORE`, each node appending its name to `process.env.WF_LOG` then a short sleep; `--kill-after <node>` self-`process.exit(137)`s right after that node's append; `--resume` reconstructs the same workflow pointed at the same store and runs to completion. (Write to the actual `@ai-sdk/workflow` surface Task 1 installed — do not invent method names; read the package's exported types with `bun pm ls` + the `node_modules/@ai-sdk/workflow/dist/*.d.ts` before writing.)

- [ ] **Step 4: Re-run + capture the transcript**

Re-run Step 2. Copy the full pass/fail transcript into the Task 3 decision record verbatim (it is the evidence).

- [ ] **Step 5: Commit the spike (regardless of adopt/fallback outcome)**

```bash
git add spikes/workflow-agent/
DOCS_OK=1 git commit -m "spike(queue): WorkflowAgent mid-DAG resume test against filesystem store (Slice 24 Incr 1)"
```
(`DOCS_OK=1` is justified: a `spikes/` commit changes no `src/**` and is not a slice landing.)

