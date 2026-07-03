# Task 5 report: Add `destDir` to the download contract + supply it from the provisioner (Slice 18, WS2)

> Note: this filename previously held a stale Slice-17 report (agent-builder
> `writeAgent` review fixes) — it has been overwritten with this Task 5 /
> Slice 18 report.

## TDD

**RED** — added a new test to `tests/provisioning/provisioner.test.ts`
(`'passes a non-empty destDir to the download provider'`), a fake
`providerFor` that captures `o.destDir` from the opts passed to `download()`,
mirroring the existing test harness's `deps()` builder. Ran:

```
bun run test:file -- "tests/provisioning/provisioner.test.ts"
```

Result: FAIL — `expect(typeof seenDestDir).toBe('string')` got `"undefined"`
(4 pass / 1 fail), confirming the contract gap exists before any
implementation change.

**GREEN** — implemented:

- `src/provisioning/types.ts`: added `destDir: string` to
  `DownloadProvider.download`'s opts type.
- `src/provisioning/provisioner.ts` (~line 114): computed
  `const destDir = process.env.HF_HOME ?? process.env.OLLAMA_MODELS ?? \`${process.cwd()}/model-images\`;`
  once per provision run and passed it in the `download(...)` call.
- `src/provisioning/providers/ollama.ts`, `lmstudio.ts`: no signature change
  needed — destructuring `{ onProgress, signal }` from a wider opts type
  already type-checks (TS doesn't require destructuring every property);
  added an explanatory comment noting `destDir` is accepted-and-ignored
  because the daemon owns its own on-disk store.
- `src/provisioning/providers/hf-fetch.ts`: same — accepted (ignored for
  now) with a comment noting Task 6 wires the actual write to `destDir`.

Re-ran:

```
bun run test:file -- "tests/provisioning/provisioner.test.ts"
```

Result: PASS — 5 pass / 0 fail / 11 expect() calls.

## Fallout beyond the brief's file list (kept the build green)

Adding a **required** `destDir` to the opts type broke two call sites the
brief didn't enumerate, because they pass an object literal directly as the
argument (TS enforces required-property checks on literal arguments, unlike
destructured params):

- `src/discovery/discover.ts` (~line 87): `runDiscovery`'s default `pull`
  fallback calls `providerFor(candidate.provider).download(model, {...})`
  with a literal opts object. Added the same env-fallback `destDir`
  computation inline (matching the provisioner's expression) and added it
  to the literal.
- `tests/provisioning/hf-fetch.test.ts` and
  `tests/provisioning/lmstudio.test.ts`: each calls `provider.download(...)`
  with a literal opts object missing `destDir`. Added
  `destDir: '/tmp/dest'` to each.

Without these two fixes `bun run typecheck` failed with:
```
error TS2345: ... Property 'destDir' is missing in type '{ onProgress...; signal: AbortSignal; }'
but required in type '{ onProgress...; signal: AbortSignal; destDir: string; }'.
```
at `hf-fetch.test.ts:28` and `lmstudio.test.ts:37`.

`tests/provisioning/eval.test.ts`'s fake `providerFor().download`
implementations (which destructure only `{ onProgress }`) needed no change —
TS accepts a narrower destructure against a wider parameter type for
method-shorthand signatures.

## Final verification

```
bun run typecheck
```
Result: 0 errors.

```
bun test
```
Result: **478 pass / 2 skip / 0 fail / 1011 expect() calls** across 139
files (220.42s) — up from the pre-task baseline of 477 pass by exactly the
one new `destDir` test added here. Build stayed green throughout. (The 2
skips are pre-existing Ollama-gated live tests, unrelated to this change.)

## Files touched

- `src/provisioning/types.ts`
- `src/provisioning/provisioner.ts`
- `src/provisioning/providers/ollama.ts`
- `src/provisioning/providers/lmstudio.ts`
- `src/provisioning/providers/hf-fetch.ts`
- `src/discovery/discover.ts` (unplanned but required call-site fix)
- `tests/provisioning/provisioner.test.ts` (new test)
- `tests/provisioning/hf-fetch.test.ts` (call-site fix)
- `tests/provisioning/lmstudio.test.ts` (call-site fix)

## Notes for WS2 Tasks 6-10

- `destDir` is currently sourced from env with a computed fallback
  (`HF_HOME` → `OLLAMA_MODELS` → `${cwd()}/model-images`) duplicated inline
  in both `provisioner.ts` and `discover.ts`'s default pull path, per the
  brief's instruction rather than extracted to a shared helper — worth a
  small dedup pass in a later task if a third call site needs the same
  fallback.
- `hf-fetch.ts` accepts `destDir` but doesn't write to it yet (still
  streams the response body without persisting bytes to disk) — that's
  explicitly Task 6's job per the brief.
