// Spike worker (Slice 24 Incr 1, D5c): attempt a durable 3-node DAG (a → b → c)
// with @ai-sdk/workflow's WorkflowAgent + a filesystem store, kill mid-DAG, and
// resume from the last completed node WITHOUT re-running completed nodes.
//
// EMPIRICAL FINDING (full write-up in .superpowers/sdd/task-2-report.md):
//   The installed @ai-sdk/workflow surface exports ONLY
//     { WorkflowAgent, WorkflowChatTransport, Output, <stream helpers> }
//   — NO store, NO workflow/step builder, NO resume entry point. WorkflowAgent is
//   an LLM agent (requires a `model`; its "steps" are LLM-driven tool calls). The
//   durable-execution substrate ('use workflow'/'use step' + event-sourced store +
//   deterministic replay/resume) lives in the SEPARATE Vercel Workflow DevKit
//   (`workflow` package), which (a) is not installed here and (b) requires a
//   BUILD-TIME esbuild compiler + framework/dev-server integration (its local
//   filesystem "World" persists events to .workflow-data/ but runs an IN-MEMORY
//   queue behind a dev server) — it is NOT a plain importable runtime store that a
//   standalone `bun worker.ts` process can cold-resume after process.exit(137).
//
// So this worker records the HONEST behavior: with no durable store reachable from
// the installed API, a `--resume` run has nothing to replay and re-executes `a`.

import { WorkflowAgent } from '@ai-sdk/workflow';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const STORE = process.env.WF_STORE;
const LOG = process.env.WF_LOG;
if (!STORE || !LOG) {
  console.error('worker: WF_STORE and WF_LOG env vars are required');
  process.exit(2);
}

const args = process.argv.slice(2);
const killAfter = args.includes('--kill-after') ? args[args.indexOf('--kill-after') + 1] : null;
const isResume = args.includes('--resume');

function ensureStoreDirs() {
  if (!existsSync(STORE!)) mkdirSync(STORE!, { recursive: true });
  mkdirSync(dirname(LOG!), { recursive: true });
}

function logNode(name: string) {
  appendFileSync(LOG!, `${name}\n`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- The 3 deterministic DAG nodes, authored in the DevKit 'use step' style. ---
// (The directive is INERT here: without the DevKit's build-time compiler it is just
// a no-op string statement — no persistence, no memoization, no skip-on-resume.)
async function nodeA() {
  'use step';
  logNode('a');
  await sleep(150);
}
async function nodeB() {
  'use step';
  logNode('b');
  await sleep(400);
}
async function nodeC() {
  'use step';
  logNode('c');
  await sleep(150);
}

// Probe the REAL installed surface for any durable store / resume capability.
function probeDurableSurface(): { hasStore: boolean; hasResume: boolean } {
  const wf = WorkflowAgent as unknown as Record<string, unknown>;
  const proto = (WorkflowAgent?.prototype ?? {}) as Record<string, unknown>;
  const keys = [...Object.getOwnPropertyNames(wf), ...Object.getOwnPropertyNames(proto)];
  const hasStore = keys.some((k) => /store|persist|checkpoint|durable|filesystem/i.test(k));
  const hasResume = keys.some((k) => /resume|replay|restore|fromStore/i.test(k));
  return { hasStore, hasResume };
}

// Try to load the actual durable substrate (the Workflow DevKit). Absent here.
async function devkitAvailable(): Promise<boolean> {
  try {
    await import('workflow');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  ensureStoreDirs();

  const { hasStore, hasResume } = probeDurableSurface();
  const devkit = await devkitAvailable();
  console.error(
    `worker[${isResume ? 'resume' : 'fresh'}]: @ai-sdk/workflow store=${hasStore} resume=${hasResume} devkit=${devkit}`,
  );

  // There is no durable store to consult and no resume entry point, so a resume run
  // cannot know which nodes already completed — it runs the DAG from the top.
  if (isResume && !hasStore && !hasResume && !devkit) {
    console.error(
      'worker[resume]: no durable store/resume in the installed API → re-executing DAG from node a',
    );
  }

  await nodeA();
  if (killAfter === 'a') process.exit(137); // self-kill mid-DAG, before b/c

  await nodeB();
  if (killAfter === 'b') process.exit(137);

  await nodeC();
  process.exit(0);
}

void main();
