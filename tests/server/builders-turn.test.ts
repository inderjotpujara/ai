import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuilderKind } from '../../src/contracts/enums.ts';
import { createRealRunBuilderTurn } from '../../src/server/launch-turns.ts';

/** True iff a local Ollama daemon is reachable. Unlike the repo's
 *  `ollamaReady(model)` helper (tests/integration/ollama-available.ts), this
 *  turn resolves its model dynamically (`resolveModel` + `PreferPolicy.
 *  LargestThatFits` over whatever the discovered registry contains), so
 *  gating on ONE specific installed model would be the wrong check here —
 *  bare daemon reachability is what actually determines whether
 *  `makeRealBuilderDeps` can resolve anything at all. */
async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/version', {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const ready = await ollamaReachable();

// This still resolves a real LanguageModel via `makeRealBuilderDeps` (model
// manager + registry) — same live-dependency class as the CLI's own
// `agent-builder.ts` `main()` — because `buildAgent` drafts (and validates)
// a real proposal via `deps.model` BEFORE `deps.confirm` is ever consulted
// (see `src/agent-builder/builder.ts`'s `draftAndValidate` preceding the
// `deps.confirm` call). Declining immediately still proves span closure
// without needing a golden-eval/verify pass — skipped (not deleted) when no
// local Ollama daemon is reachable; the live-verify pass (Increment 6)
// exercises it for real.
// A generous timeout (default bun:test is 5s): even a decline still pays for
// live model resolution/load + one real `generateText` draft call (see the
// comment above) — realistically tens of seconds on local hardware, not ms.
(ready ? test : test.skip)(
  'createRealRunBuilderTurn runs a real agent build to completion and its agent.build span closes (spans.jsonl is non-empty after settling)',
  async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'builder-turn-'));
    try {
      const turn = createRealRunBuilderTurn(runsRoot);
      const result = await turn({
        kind: BuilderKind.Agent,
        need: 'a trivial capability the builder will decline',
        runId: 'run-test-decline',
        confirm: async () => false, // decline immediately — no live model call needed to prove span closure
        confirmReuse: async () => false,
        log: () => {},
      });
      expect(result.kind).toBe('declined');
      const spansPath = join(runsRoot, 'run-test-decline', 'spans.jsonl');
      const raw = await readFile(spansPath, 'utf8');
      expect(raw).toContain('"name":"agent.build"');
    } finally {
      await rm(runsRoot, { recursive: true, force: true });
    }
  },
  120_000,
);
