### Task 9: `@huggingface/transformers` as a direct `web/` dep + Vite worker/optimizeDeps config + isolation-headers.ts comment update

**Files:**
- Modify: `web/package.json` (add the dependency)
- Modify: `web/vite.config.ts` (add `optimizeDeps.exclude`; update the `isolation` comment)
- Modify: `src/server/isolation-headers.ts` (update the stale "sherpa WASM" comment per D1/D10)
- Test: none new (config-only task — verified via `typecheck` + a full install/build smoke, per Steps 2/4 below); this task closes Increment 3, so it ends with the controller's full `bun run check` (see the note after Step 5).

**Interfaces:**
- Consumes: nothing new.
- Produces: a resolvable `@huggingface/transformers` import from within `web/` (previously only resolvable via the root workspace's hoisted install — see below), and Vite build config that keeps transformers.js's WASM binaries out of esbuild's dependency pre-bundling pass.

- [ ] **Step 1: Confirm the current (broken) state**

Run: `cd web && bun run typecheck`
Expected at this point: PASS (type-only imports still resolve via the root workspace's hoisted `node_modules/@huggingface/transformers`, since `web` is a `bun` workspace member and the root `package.json:43` already lists `"@huggingface/transformers": "^4.2.0"` as a dependency — hoisting makes the package resolvable even without `web/package.json` listing it directly). This step exists to make explicit that the FOLLOWING step is about explicitness/correctness (a workspace member should declare what it directly imports), not about fixing a current type error.

- [ ] **Step 2: Add the direct dependency**

Modify `web/package.json`'s `"dependencies"` block (insert alphabetically, matching the existing sort order):

```json
  "dependencies": {
    "@ai-sdk/react": "^3",
    "@base-ui-components/react": "1.0.0-rc.0",
    "@fontsource-variable/geist": "^5",
    "@fontsource-variable/geist-mono": "^5",
    "@huggingface/transformers": "^4.2.0",
    "@tanstack/react-router": "^1",
    "@visx/axis": "^4.0.0",
    "@visx/group": "^4.0.0",
    "@visx/scale": "^4.0.0",
    "@visx/shape": "^4.0.0",
    "@visx/tooltip": "^4.0.0",
    "@xyflow/react": "^12.11.2",
    "ai": "^6.0.217",
    "react": "^19",
    "react-dom": "^19",
    "streamdown": "^2.5.0",
    "zod": "^4.4.3"
  },
```

Run (from the repo root, since this is a `bun` workspace):
```bash
bun install
```
Expected: lockfile updates to record `web`'s now-direct dependency on `@huggingface/transformers` (already present at the root, so this should not change which version is resolved — just which `package.json` declares it).

Modify `web/vite.config.ts` to keep transformers.js's WASM binaries out of esbuild's dev-server dependency pre-bundling pass (a commonly-needed exclusion for this package — large binary assets confuse the pre-bundler):

```ts
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// COOP/COEP so the frontend can use transformers.js's threaded WASM backend
// (SharedArrayBuffer) for STT/VAD inference (Slice 30b Phase 7, D1/D8 —
// originally put in place for a since-rejected sherpa-onnx WASM plan, see
// docs/architecture.md's Voice section). The model-weight CDN fetch under
// `require-corp` was proven/adjusted by the Task 7 D10 spike — see
// `web/src/features/voice/stt.worker.ts`'s header comment for which rung of
// the fallback ladder this repo actually ships on.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts'),
    },
  },
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
  optimizeDeps: {
    // transformers.js ships its own WASM/ONNX binaries; excluding it from
    // esbuild's dependency pre-bundling avoids the dev server trying (and
    // failing) to pre-process large binary assets as JS.
    exclude: ['@huggingface/transformers'],
  },
});
```

Modify `src/server/isolation-headers.ts`'s stale comment (per D10: "the isolation-headers.ts comment gets updated off its stale 'sherpa' wording either way"):

```ts
/**
 * COOP/COEP so the frontend can use transformers.js's threaded WASM backend
 * (SharedArrayBuffer) for browser STT/VAD inference (Slice 30b Phase 7).
 * Originally put in place for a sherpa-onnx WASM plan the phase later
 * rejected (see docs/architecture.md's Voice section, D1) — the isolation
 * requirement carried over unchanged to transformers.js.
 * Lives in its own module (not `app.ts`) so route handlers under
 * `src/server/chat/**` can import it without a circular dependency on `app.ts`
 * (which imports those handlers to register routes).
 */
export const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
```

(If Task 7's D10 spike landed on Rung 2 instead of Rung 1, change both `'require-corp'` values above — here AND in `web/vite.config.ts`'s `isolation` object — to `'credentialless'` instead, per the spec's fallback ladder. As written, this task assumes Rung 1; adjust if the spike said otherwise.)

- [ ] **Step 3: (No new failing test — config-only task, see Files note.)**

- [ ] **Step 4: Run verification**

Run: `cd web && bun run typecheck`
Expected: PASS.

Run: `cd web && bun run build`
Expected: PASS — a successful production build proves `@huggingface/transformers` resolves cleanly through Vite's bundler as a direct `web/` dependency (not just via workspace hoisting) and that `stt.worker.ts`/`downsample-worklet.ts` (referenced only via `new URL(...)`, never statically imported at the top level) don't break the main bundle.

Run: `cd web && bun run test`
Expected: PASS — full `web/` suite (every test from Tasks 4-8, plus all pre-existing Phase 1-6 tests), confirming this config change didn't regress anything already shipped.

- [ ] **Step 5: Commit**

```bash
git add web/package.json bun.lock web/vite.config.ts src/server/isolation-headers.ts
git commit -m "feat(voice): @huggingface/transformers as a direct web/ dep + Vite worker config (D10)"
```

---

## Increment 3 boundary — controller gate

**After Task 9, the controller runs the full `bun run check`** (from the repo root):

```bash
bun run check
```

This runs, in order: `docs:check` (expected to PASS — Part A has made no `docs/architecture.md`-requiring change since no new `src/<subsystem>` directory was added outside already-documented `src/contracts`/`src/config`/`src/server`, and `web/src/features/voice/` is a NEW subsystem directory that Part B's Task 18 documents; if `docs:check` flags `web/src/features/voice/` as undocumented at this checkpoint, that is expected and the controller should treat it as a known, tracked gap closed by Part B, not a Part A regression) → `typecheck` (root) → `lint` (repo-wide biome) → `check:web` (`cd web && bun run typecheck && bun run test`) → `test` (root `bun test`, excluding `web/**`). All nine tasks' individual per-task gates already passed; this is the aggregate confirmation before Part B (Tasks 10-18: `use-voice-input` hook + gestures + VAD gating, composer wiring, docs + live-verify + partial-slice land) begins.

---

---


## Increment 4 — `vad.ts` segmenter + `use-voice-input` hook + both gestures

