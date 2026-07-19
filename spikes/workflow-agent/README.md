# Spike: @ai-sdk/workflow WorkflowAgent + filesystem store (Slice 24 Increment 1)

Proves/refutes D5c: does WorkflowAgent run local-first with a filesystem store
(no Vercel infra), and does a multi-node workflow killed mid-DAG resume from the
last completed node with NO re-execution of completed nodes?

Run:
    bun test spikes/workflow-agent/resume.spike.test.ts

Teardown: rm -rf spikes/workflow-agent/.wf-store

Outcome feeds docs/superpowers/plans/... Task 3 decision record.
