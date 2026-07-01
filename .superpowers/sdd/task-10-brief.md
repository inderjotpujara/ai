## Task 10: CLI `--verify` + real `VerifyDeps` wiring (consent-pull) + `unverified.txt`

**Files:** Modify `src/cli/crew.ts`, `src/cli/flow.ts`; Create `src/verification/deps.ts` (the real `VerifyDeps` factory); Test `tests/cli/verify-deps.test.ts`

**Interfaces:** Produces `makeVerifyDeps({ manager, control, generalModel }): VerifyDeps` where:
- `generate(model, prompt)` = ensureReady(model decl) → `generateText({ model: createOllamaModel({model}), prompt })` → `.text`.
- `getByIds` = the store's `getByIds`.
- `ensureJudge(model)` = if `control.isInstalled(model)` → `{model, fallback:false}`; else per `autoPullPolicy()`: `always`→pull; `prompt`+TTY→ask y/n (readline), pull on yes else `{generalModel, fallback:true}`; `never`→`{generalModel, fallback:true}`. Log the notice on fallback.

- [ ] **Step 1: Failing test** — unit-test `ensureJudge` policy with a fake control (installed → no pull; not-installed + policy 'never' → fallback; 'always' → pull called). No TTY in tests → prompt path uses 'never'/fallback.
- [ ] **Step 2–4:** Implement `makeVerifyDeps`; add `--verify` parsing to `crew.ts`/`flow.ts` that sets the crew/workflow `verify` flag and passes `VerifyDeps`; on an `unverified` outcome write `runs/<id>/unverified.txt` (draft + unsupported claims + faithfulness) instead of `result.txt` and exit non-zero.
- [ ] **Step 5: Run tests + typecheck + lint** → PASS. Commit `feat(cli): --verify flag + consent-pull judge wiring + unverified.txt`.

---

