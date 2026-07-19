# Task 2 report — Spike: WorkflowAgent mid-DAG resume against a filesystem store

**Slice 24, Increment 1 — decides D5c: adopt `@ai-sdk/workflow` `WorkflowAgent` as the
durable-execution substrate, or fall back to a custom checkpoint store.**

## Verdict: ADOPT NOT VIABLE → custom checkpoint-store fallback selected

One line: the installed `@ai-sdk/workflow` package exposes **no filesystem store, no
DAG/step builder, and no resume entry point** — its durability lives in a *separate*,
uninstalled, build-time-compiler-bound package (the Vercel Workflow DevKit), so a
plain `bun worker.ts` killed mid-DAG **re-executes the completed node `a` on resume**
(the spike's key no-re-execution assertion fails: `a` appears twice).

---

## The real API surface discovered

Read from `node_modules/@ai-sdk/workflow/{dist/index.d.ts,src/*,package.json,README.md}`
and verified at runtime.

### Runtime exports (probed, from within the project)
```
EXPORTS: Output, WorkflowAgent, WorkflowChatTransport,
         createModelCallToUIChunkTransform, normalizeUIMessageStreamParts, toUIMessageChunk
STORE/RESUME-LIKE EXPORTS: NONE
workflow DevKit import: FAILED -> ERR_MODULE_NOT_FOUND
```

- **`WorkflowAgent`** — an **LLM agent**, not a DAG runner. `WorkflowAgentOptions`
  *requires* `model: LanguageModel`; its only run method is
  `stream(options): Promise<WorkflowAgentStreamResult>`. Its "steps" are **LLM-driven
  tool calls** (`tools: ToolSet`, each with an `execute`), not user-declared graph
  nodes. There is **no** `store`/`persist`/`checkpoint` option anywhere in
  `WorkflowAgentOptions` or `WorkflowAgentStreamOptions`, and **no** `resume`/`replay`/
  `fromStore` method on the class or prototype (probed directly).
- **`WorkflowChatTransport`** — a client-side `ChatTransport` for reconnecting a
  *browser* chat stream to a server endpoint (`/api/chat`) after a network/Function
  timeout. It is HTTP-reconnect plumbing, not a durable step store.
- **`Output` / stream helpers** — structured-output spec + UI-chunk transforms.

### Where the durability actually lives (and why it is out of reach here)
The `'use workflow'` / `'use step'` directives (found in `@ai-sdk/workflow/src/**` and
its `src/test/calculate-workflow.ts`) are the authoring model of the **Vercel Workflow
DevKit** — the separate `workflow` package (a *devDependency* of `@ai-sdk/workflow`,
**not installed** in this repo). Web-verified (Vercel docs / blog, July 2026):

- WDK compiles each `'use step'` into an **isolated HTTP API route** and each
  `'use workflow'` into a sandboxed orchestrator **during an esbuild build phase** —
  the directives are **inert no-op string statements without that compiler**.
- Durability is **event sourcing**: step inputs/outputs persist to an append-only log
  and are **deterministically replayed** on crash/redeploy.
- Local dev has a filesystem store — the **"Local World"** persists events as JSON in
  `.workflow-data/` — **but it runs an in-memory queue behind a dev server**. That is a
  build-tool + framework/dev-server integration, **not** a plain importable runtime
  store a standalone `bun` process can construct and **cold-resume after
  `process.exit(137)`**.

Net: expressing the exact 3-node kill/resume shape against the *installed* API is
impossible — no store to write, no node graph to declare, no resume to call. Per the
brief, the harness was adapted to the closest faithful test of "does state persist
across a process kill and does resume skip completed work," which the installed API
answers **no** to.

## What `worker.ts` does

`spikes/workflow-agent/worker.ts` (written to the real surface):
1. Imports the real `WorkflowAgent` and **probes it** for any store/resume capability
   (own + prototype keys matching store/persist/checkpoint/durable/resume/replay/…).
2. Attempts to load the real durable substrate via `import('workflow')` (the DevKit).
3. Runs the smallest deterministic 3-node DAG `a → b → c` — each node appends its name
   to `WF_LOG` then sleeps; nodes authored in DevKit `'use step'` style (directive inert
   here). `--kill-after <node>` self-`process.exit(137)`s right after that node's append;
   `--resume` re-enters the same worker pointed at the same `WF_STORE`.
4. Because the probe finds **no store, no resume, and no DevKit**, the `--resume` run has
   nothing to replay and honestly re-runs the DAG from `a`. No real model is called.

Worker self-diagnostics (verbatim):
```
worker[fresh]:  @ai-sdk/workflow store=false resume=false devkit=false        (exit 137)
worker[resume]: @ai-sdk/workflow store=false resume=false devkit=false
worker[resume]: no durable store/resume in the installed API → re-executing DAG from node a   (exit 0)
```

## Verbatim spike transcript (the evidence for Task 3)

Command: `rm -rf spikes/workflow-agent/.wf-store && bun test spikes/workflow-agent/resume.spike.test.ts`

```
bun test v1.3.11 (af24e281)

spikes/workflow-agent/resume.spike.test.ts:
30 |   });
31 |   expect(second.status).toBe(0);
32 |   const finalLog = readFileSync(LOG, 'utf8').trim().split('\n');
33 |   expect(finalLog).toContain('c'); // completed
34 |   // The KEY assertion: "a" appears EXACTLY ONCE across both runs (no re-exec).
35 |   expect(finalLog.filter((l) => l === 'a')).toHaveLength(1);
                                                 ^
error: expect(received).toHaveLength(expected)

Expected length: 1
Received length: 2

      at <anonymous> (/Users/inderjotsingh/ai/spikes/workflow-agent/resume.spike.test.ts:35:45)
(fail) WorkflowAgent resumes mid-DAG from a filesystem store with no re-execution [1152.28ms]

 0 pass
 1 fail
 7 expect() calls
Ran 1 test across 1 file. [1179.00ms]
```

Final `nodes.log` after both runs:
```
a      <- run 1 (killed after a)
a      <- run 2 (resume) RE-EXECUTED a  ← the defect
b
c
```

### How to read it
- **6 of 7 assertions passed** — run 1 killed (`status 137 ≠ 0`), `LOG` had `a` and not
  `c`; run 2 exited `0` and reached `c`.
- **The one failing assertion is the durability crux**: `a` appears **twice** →
  the installed substrate does **not** persist completed-node state across a process
  kill and does **not** skip completed work on resume.

## Decision

**Adopt path NOT viable.** `@ai-sdk/workflow`'s `WorkflowAgent` is an LLM-agent wrapper
with no durable step store or resume of its own; the real durability (Workflow DevKit)
is a separate, uninstalled, **build-time-compiler + dev-server/framework-bound** system
whose local store cannot be driven from — or cold-resumed by — a standalone process.
**Select the custom checkpoint-store fallback** for the Slice 24 daemon/queue durable
execution. (This does not condemn `@ai-sdk/workflow` for its actual purpose — durable
*LLM agent* turns inside a WDK/Vercel deployment — only for the local-first,
process-kill-durable, deterministic multi-node DAG this slice needs.)

## Files
- `spikes/workflow-agent/resume.spike.test.ts` — the (failing, honest) spike test.
- `spikes/workflow-agent/worker.ts` — probes the real surface + runs the deterministic DAG.
- `spikes/workflow-agent/.wf-store/` — gitignored scratch (teardown: `rm -rf`).
