## Task 1: Add `@ai-sdk/workflow` behind a spike flag + scaffold the spike harness

**Files:**
- Modify: `package.json` (add `"@ai-sdk/workflow"` to `dependencies`; pin the latest v-line compatible with `ai@^7`)
- Create: `spikes/workflow-agent/README.md` (what the spike proves, how to run it, teardown note)
- Create: `spikes/workflow-agent/.gitignore` (ignore the filesystem-store scratch dir `./.wf-store/`)

**Interfaces:**
- Consumes: `ai@^7` (already a dep, `package.json`); Node `node:child_process`/`node:fs` for the kill-and-restart harness.
- Produces: nothing importable by `src/`. This is a spike dir OUTSIDE `src/` so `docs:check` never treats it as an undocumented subsystem and `bun run test` (`--path-ignore-patterns 'web/**'`) still picks up its test unless we exclude it — put the spike test under `spikes/` and run it explicitly, NOT via the normal suite (see Task 2).

- [ ] **Step 1: Verify the dep resolves against `ai@^7`**

```bash
bun add @ai-sdk/workflow
bun pm ls | grep -E '@ai-sdk/(workflow|otel)|^ai@|ai@'
```
Expected: `@ai-sdk/workflow` resolves without a peer-dependency conflict against the installed `ai@^7.x`. If it hard-conflicts (requires `ai@8`), STOP and record "adopt = blocked by peer range" straight into the Task 3 decision record — that alone selects the fallback path.

- [ ] **Step 2: Write the harness README**

`spikes/workflow-agent/README.md`:
```markdown
# Spike: @ai-sdk/workflow WorkflowAgent + filesystem store (Slice 24 Increment 1)

Proves/refutes D5c: does WorkflowAgent run local-first with a filesystem store
(no Vercel infra), and does a multi-node workflow killed mid-DAG resume from the
last completed node with NO re-execution of completed nodes?

Run:
    bun test spikes/workflow-agent/resume.spike.test.ts

Teardown: rm -rf spikes/workflow-agent/.wf-store

Outcome feeds docs/superpowers/plans/... Task 3 decision record.
```

- [ ] **Step 3: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- package.json
git add package.json spikes/workflow-agent/README.md spikes/workflow-agent/.gitignore
git commit -m "spike(queue): add @ai-sdk/workflow + spike harness scaffold (Slice 24 Incr 1)"
```

