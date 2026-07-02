### Task 6: Scoping eval + docs (all four surfaces) + live-verify

**Files:**
- Create: `tests/mcp/eval-scoping.test.ts`
- Modify: `docs/architecture.md` (new §14 + both Mermaid diagrams + glossary; renumber On-disk/Testing/Glossary)
- Modify: `README.md` (Status line, slice table row, feature paragraph, Next line)
- Modify: `docs/ROADMAP.md` (flip Phase C registry+pack markers; add "Slice 15 follow-ons" block from spec §12)
- Modify: `.superpowers/sdd/progress.md` (Slice 15 entries)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–5; live Ollama (auto-skip when down).

- [ ] **Step 1: Write the scoping eval (live-gated, auto-skip)**

Mirrors the Slice-14 fit eval: in-repo, runs only when Ollama is up; produces the evidence for the per-server `agents` decision. Scoped agents must reliably pick the right tool; the merged-set accuracy is logged for comparison, not asserted (avoids a flaky gate).

```ts
// tests/mcp/eval-scoping.test.ts
import { describe, expect, it } from 'bun:test';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import qwenFast from '../../models/qwen-fast.ts';
import { createOllamaModel } from '../../src/providers/ollama.ts';

const ollamaUp = await fetch('http://localhost:11434/api/tags').then(() => true).catch(() => false);

const noop = (name: string, desc: string) =>
  tool({
    description: desc,
    inputSchema: z.object({ input: z.string() }),
    execute: async () => ({ ok: name }),
  });

// A merged-set stand-in shaped like the real pack: many plausible distractors.
const MERGED = {
  read_file: noop('read_file', 'Read a UTF-8 text file from disk.'),
  fetch: noop('fetch', 'Fetch a URL and return page content.'),
  query: noop('query', 'Run a read-only SQL SELECT.'),
  execute: noop('execute', 'Run a writing SQL statement.'),
  git_log: noop('git_log', 'Show git commit history.'),
  browser_navigate: noop('browser_navigate', 'Open a page in a browser.'),
  create_entities: noop('create_entities', 'Store entities in the knowledge graph.'),
  get_time: noop('get_time', 'Get the current time in a timezone.'),
};
const SCOPED = { read_file: MERGED.read_file };

const CASES = [
  'Read the file ./README.md and tell me its first heading.',
  'What are the contents of package.json?',
  'Open ./docs/ROADMAP.md and summarize it.',
  'Show me what is inside src/mcp/pack.ts.',
];

async function firstToolPicked(tools: Record<string, unknown>, prompt: string): Promise<string | undefined> {
  const r = await generateText({
    model: createOllamaModel(qwenFast),
    tools: tools as Parameters<typeof generateText>[0]['tools'],
    prompt,
  });
  return r.toolCalls[0]?.toolName;
}

describe.skipIf(!ollamaUp)('eval: agents-field scoping vs merged toolset', () => {
  it('scoped agent picks read_file ≥3/4; merged accuracy logged for comparison', async () => {
    let scopedHits = 0;
    let mergedHits = 0;
    for (const c of CASES) {
      if ((await firstToolPicked(SCOPED, c)) === 'read_file') scopedHits++;
      if ((await firstToolPicked(MERGED, c)) === 'read_file') mergedHits++;
    }
    console.error(`[eval] scoped ${scopedHits}/4 vs merged ${mergedHits}/4 (read_file tasks)`);
    expect(scopedHits).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
```

Run: `bun test tests/mcp/eval-scoping.test.ts` (with `bun run serve` up)
Expected: PASS with the comparison line printed; SKIP cleanly when Ollama is down.

- [ ] **Step 2: LIVE-VERIFY (merge gate) — real registry end-to-end**

With `bun run serve` up, run each and record results in the SDD ledger:

```bash
bun run mcp list                        # 12 entries render
bun run mcp add git && bun run mcp add sqlite && bun run mcp status
bun run flow fetch-then-summarize "https://example.com"   # consent prompts fire (y), fetch works via registry
bun run src/cli/chat.ts "what is in package.json?"        # file_qa gets ONLY file-tools slice
bun run crew <existing-crew> "<input>"                    # crew path through reg.merged
```

Expected: first run prompts consent per server (exact command shown); approvals persist (second run does not re-prompt); `runs/<id>/` traces show `mcp.mount` + `workflow.tool` spans. GitHub remote HTTP: live-verify only if `GITHUB_PAT` is set; otherwise record "logged-deferred" in the ledger. Revert the `mcp.json` additions after verifying (`git checkout mcp.json`) so the committed default stays minimal.

- [ ] **Step 3: `docs/architecture.md` — new §14 + diagrams**

- Insert a new `## 14. MCP mount registry & starter pack (Slice 15)` after §13 Provisioning; renumber On-disk stores → §15, Testing strategy → §16, Glossary → §17. Content: the `src/mcp/` module list (`types/config/consent/mount/pack/client/server/sqlite-server` + `src/cli/mcp.ts`), the load→consent→mount→pin→attach flow, the spec-hash/tools-hash pinning model (secrets never stored, `.mcp-approvals.json` untracked), the dormant-until-key behavior, and the pack-as-Phase-D-palette role.
- Module map (§2): inside the `MCP` subgraph add `mcpconfig["config.ts · loadMcpConfig"]`, `mcpmount["mount.ts · mountAll"]`, `mcppack["pack.ts · STARTER_PACK"]`; add `mcp.json` + the registry to the `Declarations` subgraph as a peer of `workflows/*`/`crews/*`; reroute the `chat`/`flow`/`crewcli` dotted "mounts" edges to `mcpmount`, keep `agents -. hold tools .-> mcpclient`.
- Data-flow (§3): change the line `CLI->>CLI: buildRegistry() (offline merge) + mount MCP tools` to reflect `loadMcpConfig() → consent gate → mountAll()`.
- Layer table row **Tools / MCP**: add `config/consent/mount/pack` to the "what" column; glossary "Mounting an MCP server" entry: presets → registry + pack, mention consent + pinning.
- Update §16 Testing strategy with the real HTTP round-trip + sqlite round-trip tests.

Run: `bun run docs:check` — Expected: clean.

- [ ] **Step 4: `README.md`**

- Status line → Slice 15 shipped (mcp.json registry + starter pack).
- Slice status table: add `| 15 | mcp.json mount registry + starter pack | ✅ Done |`.
- Feature paragraph: replace the "1 mounted MCP server" phrasing with the registry + 12-entry pack + `bun run mcp` CLI; add the consent-on-mount + pinning sentence.
- "Next" line → Phase D agent-builder (or Codex-delegate follow-on).

- [ ] **Step 5: `docs/ROADMAP.md`**

- Phase C table: mark **Declarative `mcp.json` mount registry** and **Starter integration pack** ✅ shipped, Slice 15 (Codex backup stays open).
- Gap table line 50: `🟡 1 server — needs a mount registry + pack` → `✅ mcp.json registry + 12-entry pack (Slice 15)`.
- Recommended sequence item 8 → `✅ shipped, Slice 15`.
- Add `### Slice 15 follow-ons (deferred deliberately — MUST be included in future, not dropped)` mirroring spec §12: Codex delegate · OAuth (`authProvider`) · live official-registry query (v0.1/GA-pending) · shell server (sandboxing design) · `list_changed`/notifications (pinning+restart is the posture) · roots/sampling (spec-deprecated) · spec-2026-07-28/TS-SDK-v2 migration follow-on.
- Update the product-surface prose (lines 38-42) tool counts.

- [ ] **Step 6: SDD ledger + full gate + commit**

Append the Slice 15 banner + per-task lines to `.superpowers/sdd/progress.md` (format: `S15 Task N: complete (commits a..b, review ...)`), including live-verify results and any logged-deferred items (GitHub PAT).

Run: `bun run docs:check && bun run typecheck && bun run lint` then `bun test`
Expected: all green.

```bash
git add tests/mcp/eval-scoping.test.ts docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(mcp): Slice 15 architecture §14 + README/ROADMAP + scoping eval + SDD ledger (Slice 15 Task 6)"
```

- [ ] **Step 7: Regenerate the snapshot Artifact (manual reminder — tooling can only remind)**

Regenerate the interactive architecture Artifact from the updated `architecture.md`: add the MCP-registry node/edges (config→consent→mount→agents/workflow), a "Mounted deliberately" concept card, a `mcp` Terminal scenario (load→consent→mount→pin→attach→span), and bump the footer to "15 slices · <new test count> tests". Redeploy to the SAME url (`claude.ai/code/artifact/c760844f-edb5-4d7c-a965-6af76423c666`).

---

## Self-Review

**Spec coverage:** §4 format/expansion/dormant/per-entry degrade/`servers`-root tolerance → Task 1; §6 consent + spec-hash + pinning + non-TTY skip + danger flags + untracked store → Task 2 (+ `.gitignore`); §2+§7 transports (stdio+HTTP), `mountAll`, attach resolution, merged-for-tool-steps, unknown-agent warning, aggregate close → Task 3; §5 pack (12 entries, capability tags, no archived invocations) + sqlite server + `bun run mcp` CLI → Task 4; §7 startup flow in all three CLIs + committed default `mcp.json` + §9 telemetry (`withToolSpan` closing the `StepKind.Tool` gap, `mcp.mount` events) → Task 5; §11 eval + live-verify and §10 architecture-doc + four surfaces + §12 deferrals recorded in ROADMAP → Task 6. No gaps.

**Placeholder scan:** every code step shows complete code; test steps have real assertions; commands are exact with expected outcomes. Task 6 docs steps describe exact insertion points rather than full file bodies (the four surfaces are prose edits audited by the final review, per house convention).

**Type consistency:** `McpServerEntry`/`McpConfig`/`McpTransportKind`/`PackEntry` defined in Task 1, consumed verbatim in Tasks 2–5; `ApprovalRecord`/`ConsentDeps`/`specHash`/`toolsHash`/`pinTools`/`checkDrift` defined in Task 2, consumed in Task 3's `mountAll`; `McpMountSpec`/`MountedServer` (Task 3 client.ts) consumed by `mount.ts` and the sqlite/HTTP tests; `MountedRegistry.{merged,forAgent,mounted,skipped,close}` produced in Task 3, consumed by all three CLI rewires in Task 5; `withToolSpan`/`withMcpMountSpan`/`ATTR.TOOL_NAME`/`ATTR.MCP_*` defined in Task 5 Step 3 and consumed in Steps 5/7–9. Agent names `file_qa`/`web_fetch` (underscores) used consistently in `mcp.json`, pack entries, `forAgent` calls, and tests.
