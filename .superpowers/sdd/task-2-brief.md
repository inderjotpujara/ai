### Task 2: Capture `verifiedWith` at commit (agent + crew builders)

**Files:**
- Modify: `src/agent-builder/types.ts` (the builder `verify` deps type — add `verifiedWith`), `src/agent-builder/deps.ts:264` (compute from the resolved `{decl, numCtx}`), `src/agent-builder/builder.ts:267` (`commit` closure → pass into `upsertEntry`)
- Modify: `src/crew-builder/deps.ts` + `src/crew-builder/builder.ts` (symmetric)
- Test: `tests/agent-builder/gate-integration.test.ts` (or `tests/verified-build/commit-verifiedwith.test.ts`)

**Interfaces:**
- Consumes: `verifiedWithFrom` (Task 1); the resolved `{ decl, numCtx }` already computed at `src/agent-builder/deps.ts:264` (`const { decl, numCtx } = await resolveModel(...)`).
- Produces: the `verify` deps object (typed in `src/agent-builder/types.ts`) gains `verifiedWith: VerifiedWith`; both `commit` closures write it into the manifest entry via `upsertEntry(dir, name, { ...entry, verifiedWith })`.

- [ ] **Step 1: Write the failing test** — a fake builder-deps commit path asserts the persisted entry carries `verifiedWith.model`:

```ts
// Drive verifyAndCommit with a fake GateDeps whose commit is the REAL builder commit
// closure bound to a fake verify.verifiedWith; assert readManifest(dir).entries[name].verifiedWith
test('commit persists verifiedWith from the resolved model pick', async () => {
  // build a fake deps where verify.verifiedWith = { runtime: Ollama, model: 'A:7b', paramsBillions: 7, numCtx: 8192, capturedAtMs: 1 }
  // run the commit path at level=Behaves; expect readManifest(dir).entries[name]?.verifiedWith?.model === 'A:7b'
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "commit persists verifiedWith"` → FAIL (`verifiedWith` undefined on the entry).
- [ ] **Step 3: Write minimal implementation** — in `src/agent-builder/deps.ts`, immediately after the resolve at line 264 build `const verifiedWith = verifiedWithFrom({ decl, numCtx });` and expose it on the returned `verify` object (line ~331-347 block, beside `judgeCandidates`/`generatorFamily`). In `src/agent-builder/builder.ts:267` `commit`, change the `upsertEntry(verify.dir, p.name, { … })` object to include `verifiedWith: verify.verifiedWith`. Repeat symmetrically in the crew-builder deps/builder. Add `verifiedWith: VerifiedWith` to the builder verify-deps type in `src/agent-builder/types.ts` (and the crew-builder equivalent).
- [ ] **Step 4: Run test to verify it passes** — `bun run test -- -t "commit persists verifiedWith"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/agent-builder/types.ts src/agent-builder/deps.ts src/agent-builder/builder.ts src/crew-builder/deps.ts src/crew-builder/builder.ts <test>`.

```bash
git add src/agent-builder/types.ts src/agent-builder/deps.ts src/agent-builder/builder.ts src/crew-builder/deps.ts src/crew-builder/builder.ts tests/…
git commit -m "feat(verified-build): capture verifiedWith from the resolved model pick at gate commit"
```

*Model: Opus (touches the live resolve seam in two builder deps files; the capture must read the ACTUAL resolved decl, not the generator/BuilderModel).*

