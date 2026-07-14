### Task 8: Architecture docs + CI-greening + full gate

**Files:**
- Modify: `docs/architecture.md`, `.github/workflows/ci.yml`, `tests/media/consent-label.test.ts`
- (Verify) root gate green.

**Interfaces:**
- Consumes: everything above.
- Produces: an accurate `docs/architecture.md` section for the `web/` frontend scaffold; a CI workflow that exercises the `web/` workspace; a portable (CI-deterministic) media test; a green `bun run check`.

**Context — two CI-greening fixes fold into this task (see the CI diagnosis in the SDD ledger):**
Main's CI has been red since Slice 30a because of ONE environment-dependent test, and the raw `bun test` CI step does not yet know about the `web/` workspace. Both are fixed here so main's CI goes green when Phase-1b lands.

- [ ] **Step 0a: Make the media test CI-deterministic (portability fix)**

`tests/media/consent-label.test.ts` has two `generate_speech` tests that inject a `spawn` seam but NOT a `selectModel` seam, so they fall back to the real `selectGenModel(Audio)`, which returns `undefined` on the model-less Linux CI runner → the tool's graceful-degrade message (no `.wav`) → `toMatch(/\.wav$/)` fails. The sibling `tests/media/generate-tools.test.ts` already avoids this by injecting `selectModel` (see its `fakeCandidate` helper + comment).

Fix: inject a `selectModel` seam into BOTH speech tests, preserving each test's consent semantics — the candidate's `repo` must map (via `resolveVoiceModel`) to a model that `requiresCloneConsent` correctly classifies: the "clone-consent" test needs a repo that requires consent (matching the `AGENT_VOICE_MODEL='csm-1b'` intent it already sets), the "default Kokoro" test needs a Kokoro repo that does NOT require consent. Mirror `generate-tools.test.ts`'s `fakeCandidate(MediaKind.Audio, GenEngine.MlxAudio)` pattern, setting `repo` appropriately per test. After the fix, run `bun test tests/media/consent-label.test.ts` locally — it must still pass (it passed before on macOS via installed models; now it passes deterministically everywhere). Do NOT weaken the `.wav` assertions.

- [ ] **Step 0b: Teach CI about the `web/` workspace**

`.github/workflows/ci.yml`'s final step is raw `bun test`, which (a) lacks the `--path-ignore-patterns 'web/**'` guard the root `test` script now carries, so it would discover and fail the `web/` Vitest files under Bun's runner, and (b) never runs the `web/` component suite or web typecheck. `bun install --frozen-lockfile` already installs the `web/` workspace (Bun workspaces).

Fix: replace the granular `docs:check`/`typecheck`/`lint`/`bun test` steps with a single `- run: bun run check` step (which now runs `docs:check && typecheck && lint && check:web && test` — the exact local gate, including the web typecheck+Vitest and the path-ignored root tests). Keep the `checkout` + `setup-bun` + `bun install --frozen-lockfile` steps. Update the workflow's header comment to note it now also runs the `web/` gate. This keeps CI and the local `bun run check` identical (single source of truth).

- [ ] **Step 1: Update `docs/architecture.md`**

Add a subsection under the web/UI area documenting the delivered scaffold — verbatim truthful, scaffold-only:
- `web/` is a Bun workspace member (own `package.json`/`tsconfig`/Vitest); served as static assets by `src/server/` (`staticDir` + token injection + COOP/COEP).
- **Structure:** `app/` (shell, TanStack Router route tree, providers, ⌘K palette) · `shared/` (design tokens, `ThemeProvider`, Base-UI primitives, `RegionErrorBoundary`, contract client, transport port) · `features/*` (per-area stubs; isolation rule: a feature imports only `shared/` + `@contracts`).
- **Design system:** Blueprint-Mono tokens in `shared/design/tokens.css` (Tailwind v4 `@theme`, light+dark, reduced-motion, Geist via Fontsource); components reference tokens never raw hex.
- **Contract boundary:** `shared/contract/client.ts` reads `window.__AGENT_TOKEN__`, sends `Authorization: Bearer`, zod-parses against `@contracts` (`src/contracts/`).
- **Transport port:** `shared/transport/types.ts` (`ChatTransport`/`RunStream`, bidirectional + resumable per D14) — interface only; SSE adapter + `useChat` wiring is Phase 2.
- **Explicitly NOT yet built (scaffold phase):** live SSE/`useChat` streaming, feature screens, @visx/@xyflow, persistence, voice — Phases 2–8.
- Add the `web/` test lane note: component tests run under Vitest/happy-dom via `bun run check:web`, folded into `bun run check`.

Keep the module map / data-flow diagrams consistent (add a `web/` node/edge if the doc uses them for the UI). Do NOT claim streaming/chat works.

- [ ] **Step 2: Run the doc gate**

Run: `bun run docs:check`
Expected: PASS (no orphaned/undocumented living surfaces). If it flags `web/` as an undocumented `src/<subsystem>` — it should not, since `web/` is not under `src/` — investigate before proceeding.

- [ ] **Step 3: Run the full gate**

Run: `bun run check`
Expected: `docs:check` ✔ · `typecheck` ✔ (root, excludes `web/`) · `lint` ✔ (Biome, includes `web/` tsx) · `check:web` ✔ (web typecheck + Vitest, all web tests green) · `test` ✔ (root `bun test`, path-ignoring `web/**`; the media test now passes deterministically). Note: the Linux-only CI failure cannot be reproduced on macOS, but the media-test seam makes the test model-independent, so it now passes on both; the `ci.yml` change is verified by inspection + by `bun run check` being the exact command CI runs.

- [ ] **Step 4: Commit**

Commit as logically-grouped conventional commits (the harness appends the `Co-Authored-By` trailer):
```bash
git add tests/media/consent-label.test.ts
git commit -m "fix(media): inject selectModel seam so speech tests are CI-deterministic"
git add .github/workflows/ci.yml
git commit -m "ci: run the full bun run check (incl. web workspace gate)"
git add docs/architecture.md
git commit -m "docs(architecture): web/ frontend scaffold (Slice 30b Phase 1b)"
```

---

## Self-Review

**1. Spec coverage (the four Phase-1b scaffold clauses + structure):**
- "frontend test harness (Vitest/Testing-Library)" → Task 1 (Vitest 4 + RTL + happy-dom, `check:web` wired into `check`). ✔
- "design-token system (light + dark)" → Task 2 (`tokens.css`, `@theme`, both themes, Geist, reduced-motion) + Task 3 (`ThemeProvider` toggle). ✔
- "app shell + routing/providers" → Task 6 (TanStack Router, `AppShell`, 7 nav areas + run-detail, `main.tsx` providers). ✔
- "⌘K skeleton" → Task 7 (open/close/filter/keyboard-nav/registry→router). ✔
- `web/src/{app,shared}/` feature-sliced structure + per-region error boundary + isolation rule → Tasks 4/6. ✔
- Transport-port interface stub in `shared/transport` + transport-port contract test → Task 5. ✔
- Contract client consuming `src/contracts/` + token handshake → Task 5. ✔
- Deferred correctly (NOT in 1b): live SSE/`useChat`, feature screens, @visx/@xyflow, persistence, voice, ⌘K completeness — all left as stubs/interfaces. ✔

**2. Placeholder scan:** No "TBD"/"add error handling"/"write tests for the above". Every code step has complete code; every test step has real assertions. Two `_Note:_` blocks flag *verify-against-installed-version* points (Base UI Dialog export subpath, TanStack `JSX.Element` typing) — these are genuine integration-verification steps, not placeholders; the implementer resolves them against the installed package types.

**3. Type consistency:** `Theme` enum (Task 3) used in Task 3 tests; `RegionErrorBoundary`/`Button`/`Dialog` props (Task 4) consumed unchanged in Tasks 6/7; `ChatTransport`/`RunStream`/`TransportEvent` (Task 5) used in Task 5 test; `Command`/`navCommands` (Task 7) consistent between `commands.ts` and the palette; `routeTree`/`router` (Task 6) consumed by `main.tsx` + the shell test; `apiFetch`/`ApiError`/`sessionToken` (Task 5) consistent across client + tests. `@contracts` alias defined in Task 1 (tsconfig paths + vite + vitest) and consumed in Task 5. ✔

**Known integration risks flagged for execution (not blockers):**
- Base UI package export subpath (`@base-ui-components/react/dialog` vs root) — verify at Task 4.
- happy-dom portal/focus timing for the palette — Task 7 note gives the `findByRole` fallback.
- Biome may flag React-specific rules on `web/` tsx — fix inline or add scoped `biome-ignore` (two already anticipated in Tasks 5/7).
- Fontsource variable Geist package family names ("Geist Variable" / "Geist Mono Variable") — verify against installed package; tokens.css already lists system fallbacks so a mismatch degrades gracefully, not crashes.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-slice-30b-phase1b-frontend-scaffold.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

After all 8 tasks: whole-branch fan-out review → live-verify (`bun run build` in `web/` → `bun run web` serves `dist/` → real Chrome: shell renders, 7 nav routes, ⌘K opens/filters/navigates, theme toggles, `crossOriginIsolated === true`, zero console errors) → all-4-docs + Artifact regen decision → SDD ledger → land on `main`.
