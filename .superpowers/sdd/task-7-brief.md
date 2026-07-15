### Task 7: Thread `runsRoot` into `ServerDeps`

**Files:**
- Modify: `src/server/app.ts` (`ServerDeps`), `src/server/main.ts` (pass `runsRoot` into `deps`)
- Modify (fixtures): `tests/server/app.test.ts` (three `ServerDeps` literals gain `runsRoot`)
- Test: existing suites stay green (no new behavior yet — this is the wiring seam the endpoints consume)

**Interfaces:**
- Produces: `ServerDeps` gains a required `runsRoot: string`. `RunsDeps = { runsRoot: string }` (declared in Task 8, the first consumer) is a structural subset — `ServerDeps` satisfies it. `src/server/main.ts` already has `const runsRoot = 'runs'` at line 52; add `runsRoot` to the `deps` object it builds.

- [ ] **Step 1: Add the field** — in `src/server/app.ts` `ServerDeps`, after `uploadsDir`:

```ts
  /** Root dir the Runs endpoints read on-disk spans/artifacts from (Phase 3). */
  runsRoot: string;
```

- [ ] **Step 2: Wire `main.ts`** — in the `deps: ServerDeps = { ... }` literal, add `runsRoot,` (the local `const runsRoot = 'runs'` already exists at line 52).

- [ ] **Step 3: Update fixtures** — in `tests/server/app.test.ts`, add `runsRoot: 'runs'` (or a `mkdtempSync` dir) to each of the three `ServerDeps` literals (`deps`, `throwingDeps`, `confinedDeps`, `symlinkDeps` — every literal that exists). Grep to be sure none are missed: `grep -n "ServerDeps = {" tests/server/app.test.ts`.

- [ ] **Step 4: Run** — `bun run typecheck` clean (proves every `ServerDeps` construction now supplies `runsRoot`); `bun test --path-ignore-patterns 'web/**' tests/server/app.test.ts tests/server/main.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/app.ts" "src/server/main.ts" "tests/server/app.test.ts"
git add src/server/app.ts src/server/main.ts tests/server/app.test.ts
git commit -m "feat(server): thread runsRoot into ServerDeps for the Runs endpoints"
```

---

