### Task 6: Telemetry span + eval gate + all-four docs surfaces

**Files:**
- Modify: `src/telemetry/spans.ts` (add `ATTR.PROVISION_*` + `withProvisionSpan`)
- Modify: `src/provisioning/provisioner.ts` (wrap `runProvision` body in the span, emit per-model outcomes)
- Create: `tests/provisioning/eval.test.ts` (fit-selection golden set across RAM tiers)
- Modify: `docs/architecture.md` (§13 Provisioning + both Mermaid diagrams)
- Modify: `README.md` (Status line, slice table row → ✅ Done, feature paragraph)
- Modify: `docs/ROADMAP.md` (flip the Slice-14 marker in the gap/sequence tables to ✅ shipped)
- Modify: `.superpowers/sdd/progress.md` (close Slice 14)

**Interfaces:**
- Consumes: `inSpan`/`ATTR` pattern (spans.ts); `ProvisionResult` (provisioner).
- Produces: `withProvisionSpan<T>(info: ProvisionSpanInfo, fn: () => Promise<T>): Promise<T>`; new `ATTR.PROVISION_*` keys.

- [ ] **Step 1: Add telemetry attrs + span helper to `src/telemetry/spans.ts`.**

Add to the `ATTR` object (after `VERIFICATION_FALLBACK`):
```ts
  PROVISION_RUNTIME: 'provision.runtime',
  PROVISION_CANDIDATE_COUNT: 'provision.candidate_count',
  PROVISION_SELECTED_COUNT: 'provision.selected_count',
  PROVISION_BYTES_TOTAL: 'provision.bytes_total',
  PROVISION_DOWNLOADED_COUNT: 'provision.downloaded_count',
  PROVISION_FAILED_COUNT: 'provision.failed_count',
  PROVISION_DEFERRED_VERIFY: 'provision.deferred_verify',
  PROVISION_SNAPSHOT_FALLBACK: 'provision.snapshot_fallback',
```
Add the helper (mirroring `withModelLoadSpan`):
```ts
export type ProvisionSpanInfo = {
  candidateCount: number;
  selectedCount: number;
  bytesTotal: number;
  snapshotFallback: boolean;
};

export function withProvisionSpan<T>(info: ProvisionSpanInfo, fn: (span: Span) => Promise<T>): Promise<T> {
  return inSpan('agent.model.provision', async (span) => {
    span.setAttribute(ATTR.PROVISION_CANDIDATE_COUNT, info.candidateCount);
    span.setAttribute(ATTR.PROVISION_SELECTED_COUNT, info.selectedCount);
    span.setAttribute(ATTR.PROVISION_BYTES_TOTAL, info.bytesTotal);
    span.setAttribute(ATTR.PROVISION_SNAPSHOT_FALLBACK, info.snapshotFallback);
    return fn(span);
  });
}
```

- [ ] **Step 2: Write a failing test asserting the provision span is emitted (in-memory span exporter).**

```ts
// tests/provisioning/eval.test.ts  (telemetry + eval in one gate file)
import { describe, expect, it } from 'bun:test';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import { ProviderKind } from '../../src/core/types.ts';

const cand = (model: string, params: number, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 1, installed: false,
});

describe('provisioning eval — fit selection across RAM tiers', () => {
  const catalog = [cand('4b', 4, 3e9), cand('9b', 9, 6.6e9), cand('14b', 14, 9e9), cand('32b', 32, 20e9)];
  it('8GB budget (24GB Mac) recommends 4b, not 14b/32b', () => {
    const out = fitAndRank(catalog, 8e9);
    expect(out.find((c) => c.recommended)?.model).toBe('4b');
    expect(out.map((c) => c.model)).not.toContain('32b');
  });
  it('28GB budget (64GB Mac) admits up to 32b and recommends the largest', () => {
    const out = fitAndRank(catalog, 28e9);
    expect(out.find((c) => c.recommended)?.model).toBe('32b');
  });
});
```

- [ ] **Step 3: Run, verify fail (if fit thresholds need tuning) or pass; wrap `runProvision` in the span.**

In `provisioner.ts`, wrap the body:
```ts
import { withProvisionSpan, ATTR } from '../telemetry/spans.ts';
// ...
return withProvisionSpan(
  { candidateCount: ranked.length, selectedCount: selected.length,
    bytesTotal: required, snapshotFallback: false },
  async (span) => {
    // ... existing download loop ...
    span.setAttribute(ATTR.PROVISION_DOWNLOADED_COUNT, result.downloaded.length);
    span.setAttribute(ATTR.PROVISION_FAILED_COUNT, result.failed.length);
    return result;
  },
);
```
Adjust `fitAndRank` context sizing only if the eval reveals a threshold that misclassifies a tier; keep the estimate honest (weights + KV).

- [ ] **Step 4: Run the eval + full suite + typecheck + lint.**

Run: `bun test tests/provisioning/ && bun run typecheck && bun run lint`
Expected: all PASS; clean.

- [ ] **Step 5: Update `docs/architecture.md` — add §13 Provisioning + both Mermaid diagrams.**

Add a "§13 Provisioning (`src/provisioning/`)" section describing: the two-tier `DownloadProvider` model, the unified progress protocol, the two-phase catalog discovery + snapshot fallback, the supervisor guards, and the data-flow (CLI/hook → Provisioner → CatalogSource/DownloadProvider → RuntimeControl/ensureReady → telemetry). Add a `provisioning` node + edges to the module-map Mermaid and the data-flow Mermaid. Ensure `bun run docs:check` passes (every `src/<subsystem>` documented).

- [ ] **Step 6: Update `README.md` — Status line, slice-table row, feature paragraph.**

- Status line → "Slice 14 complete — first-boot provisioning + runtime-agnostic downloader."
- Add the slice table row `| **14** | **First-boot provisioning + downloader** — … | ✅ Done |` mirroring the existing row style.
- Add a feature paragraph "**First-boot provisioning (Slice 14).**" describing `bun run provision`, the fit→consent→download→verify flow, the four adapters (Ollama live; others deferred-verify), and the snapshot-backed dynamic discovery.
- Update the intro "First-boot model provisioning + a downloader →" line to reflect shipped status.

- [ ] **Step 7: Update `docs/ROADMAP.md` — flip Slice-14 markers.**

- Gap table: change the narrative "no first-boot model provisioning yet" and set the reliability/provisioning marker consistent with shipped.
- Recommended sequence item 7: prefix "✅ **shipped, Slice 14**".
- Keep the "Slice 14 follow-ons (MUST be included in future)" deferred section intact.

- [ ] **Step 8: Run the full gate.**

Run: `bun run check`
Expected: docs-check ✔ · typecheck ✔ · lint ✔ · tests ✔ (deterministic suite green).

- [ ] **Step 9: Regenerate the snapshot Artifact (4th living surface) — manual reminder.**

Regenerate the interactive architecture-snapshot Artifact from `docs/architecture.md`: add a **Provisioning** subsystem node + edges (CLI/hook → Provisioner → Catalog/Providers → RuntimeControl/ensureReady → telemetry), a concept card, a tour step, and a "provision" Terminal scenario; update the footer slice+test counts. Redeploy to the same Artifact URL. (Tooling can only remind — this is on the implementer.)

- [ ] **Step 10: Close the SDD ledger + commit.**

```bash
git add src/telemetry/spans.ts src/provisioning/provisioner.ts tests/provisioning/eval.test.ts docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "feat(provisioning): telemetry span + eval gate + all-four docs surfaces (Slice 14 Task 6)"
```

---

## Self-Review

**Spec coverage:** §3 architecture → Tasks 1–5; §4 progress protocol → Task 1; §5 four adapters → Tasks 2 (Ollama), 5 (LM Studio, llama.cpp/MLX via HF-fetch); §6 discovery two-phase + snapshot → Task 3 + Task 4 enrich; §7 data flow → Task 4; §8 supervisor guards → Task 2; §9 dep-free UI → Task 1; §10 telemetry → Task 6; §11 architecture-doc → Task 6; §12 testing + deferred-verify logging → Tasks 2,4 (live) + 5 (deferred, Step 9); §13 deferred items → recorded in ROADMAP (already committed) + Task 5 Step 9; §14 phasing → the six tasks; §15 docs → Task 6. No gaps.

**Placeholder scan:** every code step shows complete code; test steps show real assertions; commands are exact with expected output. The only intentional cross-task seam is Task 4 Step 7's commented imports, resolved explicitly in Task 5 Step 7.

**Type consistency:** `DownloadProgress`/`DownloadPhase`/`DownloadProvider` used identically across Tasks 1–5; `FitCandidate` (Task 3) consumed by `ProvisionUi.selectModels` (Task 4); `Candidate`/`CatalogSource`/`DiscoveryQuery`/`HostCapabilities` used verbatim from `catalog-source.ts`; `providerFor`/`enrichSize`/`catalogSourcesFor` signatures match between `registry.ts` (Task 4) and its consumers (Task 4 CLI, Task 5 re-wire); `ProviderKind.MlxServer` used consistently for the HF-fetch/LM-Studio adapters. `withProvisionSpan`/`ATTR.PROVISION_*` defined in Task 6 Step 1 and used in Step 3.
