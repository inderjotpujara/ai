# Decision record: resume substrate — adopt `@ai-sdk/workflow` vs. custom checkpoint store

**Slice 24, Increment 1 (Tasks 1–3).** Decides spec D5c / §7.2.

## 1. The question (D5c / §7.2)

> Does `@ai-sdk/workflow` run **local-first** with a filesystem store and **no
> Vercel infra**? Does it **wrap** our custom DAG engine (`src/workflow/`) or
> **replace** it? The web-validated facts (D5c) say it persists before every
> step, resumes from the last completed step, and supports a filesystem store
> — but "runs on our single-box local model with our runtime port" is unproven
> until the spike. **Increment 1 exists solely to resolve this**, and D5
> pre-commits the fallback (custom per-node checkpoint store) so the
> deliverable is fixed regardless. **Gate:** the spike test — a multi-node
> workflow, killed mid-DAG, resumes from the last completed node against a
> filesystem store with no re-execution of completed nodes.
>
> — spec §7.2, `docs/superpowers/specs/2026-07-19-slice-24-daemon-queue-remote-design.md`

D5 (spec, plan line 29) had pre-committed: **adopt** `WorkflowAgent` as the
durable substrate IF the spike shows it fits the local-first single-box model
cleanly; otherwise **fall back** to a custom per-node checkpoint store in
`src/workflow/`. The deliverable — resume at DAG-node granularity, no
re-execution of completed nodes — is identical either way; only the
implementation substrate for Increment 6 (Task 40/41) was undecided.

## 2. The Task 2 spike transcript

Task 2 (commit `17b7e3d`) wrote `spikes/workflow-agent/` — a probe of the
installed `@ai-sdk/workflow@1.0.31` API surface plus a deterministic 3-node
DAG (`a → b → c`) kill/resume harness. Verbatim from
`.superpowers/sdd/task-2-report.md`:

### Runtime exports (probed, from within the project)
```
EXPORTS: Output, WorkflowAgent, WorkflowChatTransport,
         createModelCallToUIChunkTransform, normalizeUIMessageStreamParts, toUIMessageChunk
STORE/RESUME-LIKE EXPORTS: NONE
workflow DevKit import: FAILED -> ERR_MODULE_NOT_FOUND
```

### Worker self-diagnostics (verbatim)
```
worker[fresh]:  @ai-sdk/workflow store=false resume=false devkit=false        (exit 137)
worker[resume]: @ai-sdk/workflow store=false resume=false devkit=false
worker[resume]: no durable store/resume in the installed API → re-executing DAG from node a   (exit 0)
```

### Spike test run (verbatim)

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

6 of 7 assertions passed (run 1 killed with status 137, log had `a` and not
`c`; run 2 exited 0 and reached `c`). **The one failing assertion is the
durability crux**: node `a` appears twice — the installed substrate does not
persist completed-node state across a process kill and does not skip
completed work on resume.

## 3. The peer-range result (Task 1)

Task 1 (commit `6ca924d`) ran `bun add @ai-sdk/workflow`. It resolved cleanly
against the already-installed `ai@7.0.31` — **no peer conflict, no forced
`ai` upgrade/downgrade, no install failure**:
```
├── @ai-sdk/otel@1.0.31
├── @ai-sdk/workflow@1.0.31
├── ai@7.0.31
```
This cleared the gating condition that would otherwise have forced an
immediate revert to the custom fallback outright (a hard peer conflict or
`ai@8` requirement), but — per Task 1's own report — does **not** by itself
decide adopt-vs-fallback; that determination rests on the Task 2 spike above.

## 4. Answers to the three spike questions

**Q1 — Does it run local-first, filesystem store, no Vercel infra?**
No, not for durable resume. The *installed* `@ai-sdk/workflow@1.0.31` package
exports only `WorkflowAgent`, `WorkflowChatTransport`, `Output`, and stream
helpers — **no store/persist/checkpoint option anywhere** in
`WorkflowAgentOptions` or `WorkflowAgentStreamOptions`, and no
`resume`/`replay`/`fromStore` method on the class or prototype (probed
directly). The real durable substrate — the `'use workflow'`/`'use step'`
directives and their event-sourced replay/filesystem-backed "Local World" —
belongs to the **separate** Vercel Workflow DevKit (`workflow` package), a
**devDependency of `@ai-sdk/workflow`, not installed** in this repo
(`import('workflow')` → `ERR_MODULE_NOT_FOUND`). Even where it does run, WDK
compiles `'use step'`/`'use workflow'` into isolated HTTP routes / a
sandboxed orchestrator via an **esbuild build phase** and its "Local World"
store runs **behind a dev server** — a build-tool + framework/dev-server
integration, not a plain importable runtime store a standalone `bun` process
can construct and cold-resume after `process.exit(137)`. So: no filesystem
store reachable from the installed API, and the real mechanism is Vercel/WDK
infra-coupled, not local-first-standalone.

**Q2 — No re-execution of completed nodes on resume?**
No. The spike's key assertion fails: killing the 3-node DAG after node `a`
and re-entering the same worker against the same `WF_STORE` **re-executes
node `a`** (`nodes.log = a, a, b, c`) because the installed API has no store
to persist `a`'s completion into and nothing to replay from. Confirmed by
independent Opus verification of the primary source
(`node_modules/@ai-sdk/workflow/dist/index.d.ts` full export set): no
filesystem/persistent store, no DAG/step builder, no resume-after-process-kill
surface exists in the package. The only "resume"-adjacent export,
`WorkflowChatTransport.reconnectToStream()`, is a **client-side HTTP chat
reconnect** (replays UI chunks by `chatId`+`startIndex`, requires a running
server) — it cannot skip completed compute, only re-attach a UI stream.

**Q3 — Does it wrap or replace our `src/workflow/` engine?**
Neither, as installed. `WorkflowAgent` is an **LLM agent**, not a DAG runner:
`WorkflowAgentOptions` *requires* `model: LanguageModel`, its only run method
is `stream()` (`generate()` is a void stub), and its "steps" are LLM-driven
tool calls (`tools: ToolSet`), not user-declared graph nodes. It has no
concept of our `WorkflowDef`/`CrewDef` node structure to wrap, and there is no
durable engine present to replace `src/workflow/` with. The only real durable
DAG engine in this dependency chain (Vercel Workflow DevKit) is absent,
build-time-compiler-bound, and dev-server/framework-coupled — unusable by a
standalone `bun` cold-resume and in tension with this project's local-first
design.

## 5. Verdict

```
SUBSTRATE = custom  (Increment 6 uses src/workflow/checkpoint.ts — Task 40b/41b)
```

## 6. Rationale

`@ai-sdk/workflow@1.0.31`'s only substantive export, `WorkflowAgent`, is an
LLM-agent wrapper (`model` required, `stream()`-only) with no store, no
DAG/step builder, and no resume entry point of its own; the actual durable,
event-sourced, crash-resumable execution model it advertises belongs to the
separate Vercel Workflow DevKit, which is not installed, requires an esbuild
build phase to turn `'use step'`/`'use workflow'` directives from inert
strings into real orchestration, and even in local dev runs its filesystem
"Local World" store behind a dev server rather than as a plain importable
runtime dependency — none of which a standalone `bun` daemon process can
construct or cold-resume after a kill. The spike proved this concretely: a
3-node DAG killed after node `a` and resumed against the installed API
re-executed `a` (`nodes.log = a,a,b,c`), failing the no-re-execution
assertion that is this increment's entire gate. Per D5's pre-committed
fallback, Increment 6 therefore executes **Task 40b** (a custom per-node
checkpoint store in `src/workflow/`) and **Task 41b**, and **skips Task 40a**
(the adopt path) as moot — its post-spike `⚠ POST-SPIKE` banner in the plan
is resolved as "not taken." The deliverable (resume at DAG-node granularity,
no re-execution of completed work) is unchanged: only the substrate
implementing it is now the custom checkpoint store rather than
`WorkflowAgent`. The `@ai-sdk/workflow` dependency added in Task 1 is, as of
this decision, unused by `src/` — only the throwaway `spikes/` harness
references it — and is marked for **removal in Increment 7 cleanup**. (This
does not condemn `@ai-sdk/workflow` for its actual purpose — durable *LLM
agent* turns inside a WDK/Vercel deployment — only for the local-first,
process-kill-durable, deterministic multi-node DAG this slice needs.)
