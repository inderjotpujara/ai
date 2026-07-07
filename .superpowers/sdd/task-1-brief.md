### Task 1: Add dependency + Bun-addon de-risking spike

**Files:**
- Modify: `package.json` (add dependency)
- Create: `scripts/spikes/sherpa-bun-smoke.ts`

**Interfaces:**
- Produces: a decision recorded in the ledger + committed spike script. Sets the default for `AGENT_VOICE_EXEC` (`inprocess` if the addon loads under Bun, else `subprocess`).

- [ ] **Step 1: Add the dependency**

Run: `bun add sherpa-onnx-node@1.13.4`
Then confirm the resolved version + the platform prebuilt package name:
Run: `bun pm ls | grep sherpa` and `ls node_modules | grep sherpa`
Expected: `sherpa-onnx-node` present + a `sherpa-onnx-darwin-arm64` (or similarly named) prebuilt dir. Record the exact prebuilt dir name — it is needed for `DYLD_LIBRARY_PATH`.

- [ ] **Step 2: Write the smoke spike**

```ts
// scripts/spikes/sherpa-bun-smoke.ts
// Smoke-test whether Bun can load the sherpa-onnx-node N-API addon.
// Run: bun run scripts/spikes/sherpa-bun-smoke.ts
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules');
// The addon needs its bundled .dylibs on the dyld search path at load time.
process.env.DYLD_LIBRARY_PATH = [
  join(root, 'sherpa-onnx-node'),
  join(root, 'sherpa-onnx-darwin-arm64'),
  process.env.DYLD_LIBRARY_PATH ?? '',
].join(':');

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sherpa = require('sherpa-onnx-node');
  console.log('LOADED', Object.keys(sherpa).slice(0, 12));
  console.log('HAS_OfflineRecognizer', typeof sherpa.OfflineRecognizer);
  process.exit(typeof sherpa.OfflineRecognizer === 'function' ? 0 : 2);
} catch (err) {
  console.error('LOAD_FAILED', (err as Error).message);
  process.exit(1);
}
```

- [ ] **Step 3: Run the spike under Bun**

Run: `bun run scripts/spikes/sherpa-bun-smoke.ts`
Expected: either `LOADED [...]` + `HAS_OfflineRecognizer function` (exit 0 → default `inprocess`), or `LOAD_FAILED ...` (exit 1 → default `subprocess`; also confirm `command -v node` exists for the fallback).

- [ ] **Step 4: Record the outcome**

Append the result (loads under Bun? y/n; prebuilt dir name; node available?) to `.superpowers/sdd/progress.md` under a new `## SLICE 29` heading. This decides the `createTranscriber` default in Task 7.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock scripts/spikes/sherpa-bun-smoke.ts .superpowers/sdd/progress.md
git commit -m "chore(slice-29): add sherpa-onnx-node + Bun-addon smoke spike"
```

---

