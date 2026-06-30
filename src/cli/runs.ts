import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunSummary } from '../run/run-trace.ts';
import { buildTree, readSpans, summarizeRun } from '../run/run-trace.ts';
import { renderRunList, renderTimeline } from './render-trace.ts';

function runsRootDir(): string {
  return process.env.AGENT_RUNS_ROOT ?? 'runs';
}

export async function renderRun(runsRoot: string, id: string): Promise<string> {
  const { spans, malformed } = await readSpans(join(runsRoot, id));
  if (spans.length === 0) return `No spans for run '${id}'.`;
  const body = renderTimeline(buildTree(spans));
  return malformed > 0
    ? `${body}\n(${malformed} malformed span line(s) skipped)`
    : body;
}

export async function listRuns(runsRoot: string): Promise<string> {
  let ids: string[];
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return 'No runs found.';
  }
  const summaries: RunSummary[] = [];
  for (const id of ids) {
    const s = await summarizeRun(runsRoot, id);
    if (s) summaries.push(s);
  }
  if (summaries.length === 0) return 'No runs found.';
  return renderRunList(summaries);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const follow = args.includes('--follow');
  const id = args.find((a) => !a.startsWith('--'));
  const root = runsRootDir();
  if (!id) {
    console.log(await listRuns(root));
    return;
  }
  if (follow) {
    let last = '';
    const tick = async () => {
      const out = await renderRun(root, id);
      if (out !== last) {
        console.clear();
        console.log(out);
        last = out;
      }
    };
    await tick();
    const timer = setInterval(() => {
      void tick();
    }, 500);
    const stopper = setInterval(async () => {
      const { spans } = await readSpans(join(root, id));
      if (spans.some((s) => s.name === 'agent.run')) {
        clearInterval(timer);
        clearInterval(stopper);
        await tick();
      }
    }, 500);
    // Reference stopper to satisfy linter (used via clearInterval above)
    void stopper;
    return;
  }
  console.log(await renderRun(root, id));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
