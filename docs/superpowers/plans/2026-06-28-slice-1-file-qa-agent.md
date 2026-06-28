# Slice 1: Local File Q&A Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable CLI where you ask a question about a local file and a local Ollama model answers it by calling a `read_file` tool — with autonomous model warm-up/unload and a file-based run record.

**Architecture:** Bun + TypeScript on **Vercel AI SDK 6** (the tool-calling loop). A thin `Agent` wraps `generateText` with a `stopWhen` step guard. The `read_file` tool is exposed over **MCP** (`@modelcontextprotocol/sdk`) and consumed via the AI SDK MCP client; the agent itself takes a generic `ToolSet`, so it's decoupled from the tool source and unit-testable with an in-process tool + the mock model. A minimal Resource layer ensures the model is present, fits the GPU memory budget, is warmed before use and unloaded after. Each run writes artifacts + an append-only journal to `runs/<id>/`.

**Tech Stack:** Bun, TypeScript 5.9, AI SDK 6 (`ai@^6`), `ollama-ai-provider-v2@^3`, `@ai-sdk/mcp@^1`, `@modelcontextprotocol/sdk@^1`, `zod@^4`, Biome (lint/format), `bun test` (with `ai/test` mock model).

## Global Constraints

- **Runtime/stack:** Bun + TypeScript, ESM (`"type": "module"`). Prefer `type` over `interface`; **string `enum`s** over string-literal unions for finite sets (e.g. `ProviderKind`). Early returns over nested conditionals. Small, single-responsibility files; plain, self-explanatory code — no dense/clever code.
- **Version pins (DO NOT use `@latest` — npm latest is AI SDK v7, which renames our APIs):** `ai@^6` (6.0.214), `ollama-ai-provider-v2@^3` (3.6.0), `@ai-sdk/mcp@^1` (1.0.55), `@modelcontextprotocol/sdk@^1` (1.29.0), `zod@^4` (4.4.3); dev: `typescript@^5.9`, `@biomejs/biome@2.5.1`, `@types/bun@^1.3`.
- **AI SDK 6 exact API:** loop = `generateText({ model, system, prompt, tools, stopWhen: stepCountIs(N) })`; tool = `tool({ description, inputSchema: z.object({...}), execute })` (it is `inputSchema`, **not** `parameters`); mock = `MockLanguageModelV3` from `ai/test`; MCP client = `createMCPClient` from `@ai-sdk/mcp` + `Experimental_StdioMCPTransport` from `@ai-sdk/mcp/mcp-stdio`.
- **Ollama HTTP:** base `http://localhost:11434`. Write requests use field **`model`**; `GET /api/tags` and `GET /api/ps` report it back as **`name`**. Provider `baseURL` needs the **`/api`** suffix: `http://localhost:11434/api`.
- **Apple Silicon facts:** GPU-usable budget ≈ **0.75 × total RAM** (Metal wired limit). `os.freemem()` is unreliable on macOS — not used in this slice (we budget against `os.totalmem()`).
- **MCP server purity:** the MCP server process must write **only JSON-RPC to stdout** — no `console.log` to stdout (use `console.error`/stderr for any logging).
- **Autonomy:** no manual user steps in the happy path — the CLI pulls the model if missing, warms it, and unloads it itself.
- **No git repo yet:** this folder is not a git repo. Either run `git init` during Task 1 to use the commit steps, or skip every `git commit` step (the workflow is identical without them).

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `tests/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: working `bun run typecheck`, `bun run test`, `bun run test:file`, `bun run lint`, `bun run lint:file`; all runtime deps installed.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "local-agents",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "test:file": "bun test",
    "lint": "biome check .",
    "lint:file": "biome check"
  },
  "dependencies": {
    "ai": "^6.0.214",
    "zod": "^4.4.3",
    "ollama-ai-provider-v2": "^3.6.0",
    "@ai-sdk/mcp": "^1.0.55",
    "@modelcontextprotocol/sdk": "^1.29.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@biomejs/biome": "2.5.1",
    "@types/bun": "^1.3.14"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["bun"]
  }
}
```

- [ ] **Step 3: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.1/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": false },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always" }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
runs/
*.log
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `bun install`
Expected: creates `bun.lock` and `node_modules/`; exits 0.

- [ ] **Step 6: Write a scaffold smoke test** — `tests/scaffold.test.ts`

```ts
import { expect, test } from 'bun:test';

test('test runner works', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 7: Verify the toolchain**

Run: `bun run typecheck && bun run test && bun run lint`
Expected: typecheck exits 0; test shows `1 pass`; lint reports no errors (run `bun run lint -- --write` once if it only reports formatting).

- [ ] **Step 8: Commit** (skip if no git repo; run `git init` first to use)

```bash
git init
git add package.json tsconfig.json biome.json .gitignore tests/scaffold.test.ts bun.lock
git commit -m "chore: scaffold bun + typescript project with biome and ai sdk 6"
```

---

### Task 2: Shared types & typed errors

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/errors.ts`
- Test: `tests/core/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `enum ProviderKind { Ollama = 'Ollama' }`
  - `type ModelParams = { temperature?: number; numCtx?: number }`
  - `type ModelDeclaration = { provider: ProviderKind; model: string; params: ModelParams; role: string }`
  - Error classes: `ProviderError`, `ToolError`, `MaxStepsError`, `ResourceError` (each `extends Error` with `name` set to the class name).

- [ ] **Step 1: Write the failing test** — `tests/core/errors.test.ts`

```ts
import { expect, test } from 'bun:test';
import { ProviderError, ResourceError } from '../../src/core/errors.ts';

test('typed errors carry their class name and message', () => {
  const err = new ResourceError('model does not fit budget');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('ResourceError');
  expect(err.message).toBe('model does not fit budget');
});

test('ProviderError preserves an optional cause', () => {
  const cause = new Error('connection refused');
  const err = new ProviderError('ollama unreachable', { cause });
  expect(err.name).toBe('ProviderError');
  expect(err.cause).toBe(cause);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/errors.test.ts`
Expected: FAIL — cannot resolve `../../src/core/errors.ts`.

- [ ] **Step 3: Create `src/core/types.ts`**

```ts
/** Which local runtime backs a model. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama',
}

/** Tunable inference parameters carried by a model declaration. */
export type ModelParams = {
  temperature?: number;
  numCtx?: number;
};

/**
 * A model declaration is DATA, not logic. Slice 1 pins a concrete model name;
 * later slices can resolve a capability/role to a discovered model.
 */
export type ModelDeclaration = {
  provider: ProviderKind;
  model: string;
  params: ModelParams;
  role: string;
};
```

- [ ] **Step 4: Create `src/core/errors.ts`**

```ts
/** Base for all framework errors; sets `name` to the concrete class name. */
class FrameworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A model provider/runtime failed (e.g. Ollama unreachable). */
export class ProviderError extends FrameworkError {}

/** A tool failed in a way the loop could not recover from. */
export class ToolError extends FrameworkError {}

/** The agent loop hit its step ceiling without finishing. */
export class MaxStepsError extends FrameworkError {}

/** A model cannot fit the machine's memory budget. */
export class ResourceError extends FrameworkError {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:file -- ./tests/core/errors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/errors.ts tests/core/errors.test.ts
git commit -m "feat(core): add shared model types and typed errors"
```

---

### Task 3: Model footprint estimator

**Files:**
- Create: `src/resource/footprint.ts`
- Test: `tests/resource/footprint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `estimateModelBytes(input: FootprintInput): number` where
  `type FootprintInput = { paramsBillions: number; bytesPerWeight: number; contextTokens: number; kvBytesPerToken: number }`.
  Formula: `weights = paramsBillions × 1e9 × bytesPerWeight × 1.2` (20% runtime overhead) `+ contextTokens × kvBytesPerToken`. Returns whole bytes.

- [ ] **Step 1: Write the failing test** — `tests/resource/footprint.test.ts`

```ts
import { expect, test } from 'bun:test';
import { estimateModelBytes } from '../../src/resource/footprint.ts';

test('estimates an 8B Q4_K_M model with 8k context', () => {
  // weights = 8e9 * 0.56 * 1.2 = 5,376,000,000 ; kv = 8192 * 131072 = 1,073,741,824
  const bytes = estimateModelBytes({
    paramsBillions: 8,
    bytesPerWeight: 0.56,
    contextTokens: 8192,
    kvBytesPerToken: 131072,
  });
  expect(bytes).toBe(5_376_000_000 + 1_073_741_824);
});

test('zero context means weights-only', () => {
  const bytes = estimateModelBytes({
    paramsBillions: 1,
    bytesPerWeight: 2,
    contextTokens: 0,
    kvBytesPerToken: 999,
  });
  expect(bytes).toBe(1e9 * 2 * 1.2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/resource/footprint.test.ts`
Expected: FAIL — cannot resolve `footprint.ts`.

- [ ] **Step 3: Create `src/resource/footprint.ts`**

```ts
/** Inputs for a rough pre-load RAM estimate of a quantized model. */
export type FootprintInput = {
  paramsBillions: number;
  bytesPerWeight: number;
  contextTokens: number;
  kvBytesPerToken: number;
};

const RUNTIME_OVERHEAD = 1.2;

/**
 * Estimate the RAM a model needs before loading it.
 * weights = params * bytesPerWeight * overhead; plus a KV-cache term that grows with context.
 */
export function estimateModelBytes(input: FootprintInput): number {
  const weights =
    input.paramsBillions * 1e9 * input.bytesPerWeight * RUNTIME_OVERHEAD;
  const kvCache = input.contextTokens * input.kvBytesPerToken;
  return weights + kvCache;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/resource/footprint.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resource/footprint.ts tests/resource/footprint.test.ts
git commit -m "feat(resource): add model memory footprint estimator"
```

---

### Task 4: Hardware memory budget

**Files:**
- Create: `src/resource/hardware.ts`
- Test: `tests/resource/hardware.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GPU_BUDGET_FRACTION = 0.75`
  - `gpuBudgetBytes(totalRamBytes: number): number` — `Math.floor(totalRamBytes × 0.75)`.
  - `machineBudgetBytes(): number` — `gpuBudgetBytes(os.totalmem())`.
  - `fitsBudget(modelBytes: number, budgetBytes: number): boolean`.

- [ ] **Step 1: Write the failing test** — `tests/resource/hardware.test.ts`

```ts
import { expect, test } from 'bun:test';
import {
  fitsBudget,
  gpuBudgetBytes,
  machineBudgetBytes,
} from '../../src/resource/hardware.ts';

test('gpu budget is 75% of total ram, floored', () => {
  expect(gpuBudgetBytes(24 * 1024 ** 3)).toBe(Math.floor(24 * 1024 ** 3 * 0.75));
});

test('fitsBudget compares model size to budget', () => {
  expect(fitsBudget(5_000_000_000, 18_000_000_000)).toBe(true);
  expect(fitsBudget(20_000_000_000, 18_000_000_000)).toBe(false);
});

test('machineBudgetBytes returns a positive number for this machine', () => {
  expect(machineBudgetBytes()).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/resource/hardware.test.ts`
Expected: FAIL — cannot resolve `hardware.ts`.

- [ ] **Step 3: Create `src/resource/hardware.ts`**

```ts
import os from 'node:os';

/**
 * Apple Silicon caps the Metal GPU working set at ~75% of unified memory.
 * That fraction — not os.freemem() (unreliable on macOS) — is the real ceiling
 * for accelerated inference.
 */
export const GPU_BUDGET_FRACTION = 0.75;

/** GPU-usable bytes for a given total-RAM figure. */
export function gpuBudgetBytes(totalRamBytes: number): number {
  return Math.floor(totalRamBytes * GPU_BUDGET_FRACTION);
}

/** GPU-usable bytes for the current machine. */
export function machineBudgetBytes(): number {
  return gpuBudgetBytes(os.totalmem());
}

/** Does a model of `modelBytes` fit within `budgetBytes`? */
export function fitsBudget(modelBytes: number, budgetBytes: number): boolean {
  return modelBytes <= budgetBytes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/resource/hardware.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resource/hardware.ts tests/resource/hardware.test.ts
git commit -m "feat(resource): add gpu memory budget detection"
```

---

### Task 5: Ollama control client

**Files:**
- Create: `src/resource/ollama-control.ts`
- Test: `tests/resource/ollama-control.test.ts`

**Interfaces:**
- Consumes: `ProviderError` from `src/core/errors.ts`.
- Produces (all default `baseUrl = 'http://localhost:11434'`):
  - `isModelInstalled(model: string, baseUrl?: string): Promise<boolean>` — `GET /api/tags`, checks `models[].name`.
  - `pullModel(model: string, baseUrl?: string): Promise<void>` — `POST /api/pull { model, stream: false }`.
  - `warmModel(model: string, baseUrl?: string): Promise<void>` — `POST /api/generate { model }`.
  - `unloadModel(model: string, baseUrl?: string): Promise<void>` — `POST /api/generate { model, keep_alive: 0 }`.

- [ ] **Step 1: Write the failing test** — `tests/resource/ollama-control.test.ts`

```ts
import { afterEach, expect, spyOn, test } from 'bun:test';
import {
  isModelInstalled,
  pullModel,
} from '../../src/resource/ollama-control.ts';

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
});

test('isModelInstalled returns true when /api/tags lists the model by name', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), {
      status: 200,
    }),
  );
  expect(await isModelInstalled('qwen3:8b')).toBe(true);
  expect(await isModelInstalled('llama3:8b')).toBe(false);
});

test('pullModel POSTs the model field and resolves on 200', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status: 'success' }), { status: 200 }),
  );
  await pullModel('qwen3:8b');
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://localhost:11434/api/pull');
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'qwen3:8b',
    stream: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/resource/ollama-control.test.ts`
Expected: FAIL — cannot resolve `ollama-control.ts`.

- [ ] **Step 3: Create `src/resource/ollama-control.ts`**

```ts
import { ProviderError } from '../core/errors.ts';

const DEFAULT_BASE_URL = 'http://localhost:11434';

type TagsResponse = { models?: Array<{ name: string }> };

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ProviderError(`Ollama request to ${path} failed`, { cause });
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama ${path} returned ${res.status}`);
  }
}

/** True if `model` appears in `GET /api/tags` (field is `name`, not `model`). */
export async function isModelInstalled(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/tags`);
  } catch (cause) {
    throw new ProviderError('Ollama /api/tags failed', { cause });
  }
  if (!res.ok) throw new ProviderError(`Ollama /api/tags returned ${res.status}`);
  const data = (await res.json()) as TagsResponse;
  return (data.models ?? []).some((m) => m.name === model);
}

/** Pull a model (blocking, non-streamed). Write field is `model`. */
export function pullModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  return postJson(baseUrl, '/api/pull', { model, stream: false });
}

/** Warm/preload a model into memory with an empty-prompt generate. */
export function warmModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  return postJson(baseUrl, '/api/generate', { model });
}

/** Unload a model from memory immediately (keep_alive: 0). */
export function unloadModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  return postJson(baseUrl, '/api/generate', { model, keep_alive: 0 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/resource/ollama-control.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resource/ollama-control.ts tests/resource/ollama-control.test.ts
git commit -m "feat(resource): add ollama control client (tags/pull/warm/unload)"
```

---

### Task 6: Run journal

**Files:**
- Create: `src/run/journal.ts`
- Test: `tests/run/journal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type JournalEntry = { step: string; data?: unknown }`
  - `appendJournal(dir: string, entry: JournalEntry): Promise<void>` — appends one JSON line to `<dir>/journal.jsonl` (each line includes a monotonic `index`).
  - `readJournal(dir: string): Promise<Array<JournalEntry & { index: number }>>`.

- [ ] **Step 1: Write the failing test** — `tests/run/journal.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendJournal, readJournal } from '../../src/run/journal.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'journal-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('appends entries as ordered JSON lines and reads them back', async () => {
  await appendJournal(dir, { step: 'start' });
  await appendJournal(dir, { step: 'answer', data: { text: 'hi' } });
  const entries = await readJournal(dir);
  expect(entries).toEqual([
    { index: 0, step: 'start' },
    { index: 1, step: 'answer', data: { text: 'hi' } },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/run/journal.test.ts`
Expected: FAIL — cannot resolve `journal.ts`.

- [ ] **Step 3: Create `src/run/journal.ts`**

```ts
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type JournalEntry = { step: string; data?: unknown };
type StoredEntry = JournalEntry & { index: number };

function journalPath(dir: string): string {
  return join(dir, 'journal.jsonl');
}

/** Append one entry as a JSON line, stamped with the next index. */
export async function appendJournal(
  dir: string,
  entry: JournalEntry,
): Promise<void> {
  const existing = await readJournal(dir);
  const stored: StoredEntry = { index: existing.length, ...entry };
  await appendFile(journalPath(dir), `${JSON.stringify(stored)}\n`);
}

/** Read all entries in order; empty array if the journal does not exist yet. */
export async function readJournal(dir: string): Promise<StoredEntry[]> {
  let raw: string;
  try {
    raw = await readFile(journalPath(dir), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StoredEntry);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/run/journal.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/run/journal.ts tests/run/journal.test.ts
git commit -m "feat(run): add append-only jsonl run journal"
```

---

### Task 7: Run store

**Files:**
- Create: `src/run/run-store.ts`
- Test: `tests/run/run-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RunHandle = { id: string; dir: string }`
  - `createRun(rootDir: string, id: string): Promise<RunHandle>` — creates `<rootDir>/<id>/` and returns the handle.
  - `writeArtifact(run: RunHandle, name: string, contents: string): Promise<string>` — writes `<dir>/<name>`, returns full path.

- [ ] **Step 1: Write the failing test** — `tests/run/run-store.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, writeArtifact } from '../../src/run/run-store.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'runs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('creates a run dir and writes an artifact into it', async () => {
  const run = await createRun(root, 'run-123');
  expect(run.id).toBe('run-123');
  expect(run.dir).toBe(join(root, 'run-123'));
  const path = await writeArtifact(run, 'answer.txt', 'the answer');
  expect(await readFile(path, 'utf8')).toBe('the answer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/run/run-store.test.ts`
Expected: FAIL — cannot resolve `run-store.ts`.

- [ ] **Step 3: Create `src/run/run-store.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type RunHandle = { id: string; dir: string };

/** Create (or reuse) the directory for a run and return its handle. */
export async function createRun(
  rootDir: string,
  id: string,
): Promise<RunHandle> {
  const dir = join(rootDir, id);
  await mkdir(dir, { recursive: true });
  return { id, dir };
}

/** Write a text artifact into the run directory; returns its full path. */
export async function writeArtifact(
  run: RunHandle,
  name: string,
  contents: string,
): Promise<string> {
  const path = join(run.dir, name);
  await writeFile(path, contents);
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/run/run-store.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/run/run-store.ts tests/run/run-store.test.ts
git commit -m "feat(run): add file-based run store"
```

---

### Task 8: read_file tool

**Files:**
- Create: `src/tools/read-file.ts`
- Test: `tests/tools/read-file.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readFileText(path: string): Promise<string>` — pure helper, reads a UTF-8 file.
  - `readFileTool` — an AI SDK `tool` named conceptually `read_file` with `inputSchema: z.object({ path: z.string() })` whose `execute` returns `{ text }` on success or `{ error }` on failure (errors returned to the model, not thrown).

- [ ] **Step 1: Write the failing test** — `tests/tools/read-file.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileText, readFileTool } from '../../src/tools/read-file.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'readfile-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('readFileText returns file contents', async () => {
  const p = join(dir, 'note.txt');
  await writeFile(p, 'hello file');
  expect(await readFileText(p)).toBe('hello file');
});

test('tool execute returns text on success', async () => {
  const p = join(dir, 'note.txt');
  await writeFile(p, 'tool content');
  const result = await readFileTool.execute!({ path: p }, {} as never);
  expect(result).toEqual({ text: 'tool content' });
});

test('tool execute returns a structured error for a missing file', async () => {
  const result = await readFileTool.execute!(
    { path: join(dir, 'missing.txt') },
    {} as never,
  );
  expect(result).toHaveProperty('error');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/tools/read-file.test.ts`
Expected: FAIL — cannot resolve `read-file.ts`.

- [ ] **Step 3: Create `src/tools/read-file.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { tool } from 'ai';
import { z } from 'zod';

/** Pure helper: read a UTF-8 file's contents. */
export function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/**
 * The `read_file` tool. On failure it RETURNS an error object (rather than
 * throwing) so the model sees it as a tool result and can recover.
 */
export const readFileTool = tool({
  description: 'Read a UTF-8 text file from disk and return its contents.',
  inputSchema: z.object({
    path: z.string().describe('Absolute or relative path to the file to read'),
  }),
  execute: async ({ path }) => {
    try {
      return { text: await readFileText(path) };
    } catch (cause) {
      return { error: `Could not read ${path}: ${(cause as Error).message}` };
    }
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/tools/read-file.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/read-file.ts tests/tools/read-file.test.ts
git commit -m "feat(tools): add read_file tool with structured error result"
```

---

### Task 9: Ollama model provider + declaration

**Files:**
- Create: `src/providers/ollama.ts`
- Create: `models/qwen-fast.ts`
- Test: `tests/providers/ollama.test.ts`

**Interfaces:**
- Consumes: `ModelDeclaration`, `ProviderKind` from `src/core/types.ts`.
- Produces:
  - `createOllamaModel(decl: ModelDeclaration): LanguageModel` — builds a model via `createOllama({ baseURL: 'http://localhost:11434/api' })`.
  - `models/qwen-fast.ts` default export: a `ModelDeclaration` for `qwen3:8b`.

- [ ] **Step 1: Write the failing test** — `tests/providers/ollama.test.ts`

```ts
import { expect, test } from 'bun:test';
import { createOllamaModel } from '../../src/providers/ollama.ts';
import { ProviderKind } from '../../src/core/types.ts';
import qwenFast from '../../models/qwen-fast.ts';

test('qwen-fast declaration targets qwen3:8b on ollama', () => {
  expect(qwenFast.provider).toBe(ProviderKind.Ollama);
  expect(qwenFast.model).toBe('qwen3:8b');
});

test('createOllamaModel returns a model whose id matches the declaration', () => {
  const model = createOllamaModel(qwenFast);
  expect(model.modelId).toBe('qwen3:8b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/providers/ollama.test.ts`
Expected: FAIL — cannot resolve `ollama.ts` / `qwen-fast.ts`.

- [ ] **Step 3: Create `models/qwen-fast.ts`**

```ts
import { ProviderKind, type ModelDeclaration } from '../src/core/types.ts';

/** Fast general-purpose local model with reliable tool-calling. */
const qwenFast: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3:8b',
  params: { temperature: 0.2, numCtx: 8192 },
  role: 'general reasoning + tool use',
};

export default qwenFast;
```

- [ ] **Step 4: Create `src/providers/ollama.ts`**

```ts
import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import type { ModelDeclaration } from '../core/types.ts';

// The provider's baseURL needs the /api suffix (per its own examples).
const OLLAMA_BASE_URL = 'http://localhost:11434/api';

/** Build an AI SDK LanguageModel for an Ollama-backed declaration. */
export function createOllamaModel(decl: ModelDeclaration): LanguageModel {
  const ollama = createOllama({ baseURL: OLLAMA_BASE_URL });
  return ollama(decl.model);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:file -- ./tests/providers/ollama.test.ts`
Expected: PASS (2 tests). If `model.modelId` is undefined on this provider version, assert the model is a non-null object instead (`expect(model).toBeTruthy()`) and note the provider shape.

- [ ] **Step 6: Commit**

```bash
git add src/providers/ollama.ts models/qwen-fast.ts tests/providers/ollama.test.ts
git commit -m "feat(providers): add ollama model factory and qwen3:8b declaration"
```

---

### Task 10: Agent loop

**Files:**
- Create: `src/core/agent.ts`
- Test: `tests/core/agent.test.ts`

**Interfaces:**
- Consumes: `generateText`, `stepCountIs`, `ToolSet`, `LanguageModel` from `ai`.
- Produces:
  - `type RunAgentInput = { model: LanguageModel; systemPrompt: string; prompt: string; tools: ToolSet; maxSteps?: number; providerOptions?: Record<string, Record<string, unknown>>; temperature?: number }`
  - `runAgent(input: RunAgentInput): Promise<{ text: string }>` — runs `generateText` with `stopWhen: stepCountIs(maxSteps ?? 10)`.

- [ ] **Step 1: Write the failing test** — `tests/core/agent.test.ts`

```ts
import { expect, mock, test } from 'bun:test';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { runAgent } from '../../src/core/agent.ts';

test('agent calls the tool then returns the final answer', async () => {
  const execute = mock(async ({ path }: { path: string }) => ({
    text: `contents of ${path}`,
  }));

  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'read_file',
              input: JSON.stringify({ path: '/tmp/x.txt' }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: 'The file says hello.' }],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
  });

  const tools = {
    read_file: tool({
      description: 'read a file',
      inputSchema: z.object({ path: z.string() }),
      execute,
    }),
  };

  const { text } = await runAgent({
    model,
    systemPrompt: 'You answer questions about files.',
    prompt: 'What does /tmp/x.txt say?',
    tools,
  });

  expect(execute).toHaveBeenCalledWith({ path: '/tmp/x.txt' }, expect.anything());
  expect(text).toBe('The file says hello.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/agent.test.ts`
Expected: FAIL — cannot resolve `agent.ts`.

- [ ] **Step 3: Create `src/core/agent.ts`**

```ts
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';

const DEFAULT_MAX_STEPS = 10;

export type RunAgentInput = {
  model: LanguageModel;
  systemPrompt: string;
  prompt: string;
  tools: ToolSet;
  maxSteps?: number;
  temperature?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
};

/** Run one agent turn: model + tools loop, bounded by a step guard. */
export async function runAgent(
  input: RunAgentInput,
): Promise<{ text: string }> {
  const { text } = await generateText({
    model: input.model,
    system: input.systemPrompt,
    prompt: input.prompt,
    tools: input.tools,
    temperature: input.temperature,
    providerOptions: input.providerOptions,
    stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
  });
  return { text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/core/agent.test.ts`
Expected: PASS (1 test). If TypeScript flags the mock's `finishReason`/`usage` shape, match it to the installed `LanguageModelV3` type (the string `'stop'`/`'tool-calls'` form is the documented v6 shape).

- [ ] **Step 5: Commit**

```bash
git add src/core/agent.ts tests/core/agent.test.ts
git commit -m "feat(core): add agent loop over ai sdk generateText"
```

---

### Task 11: MCP server + client

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/client.ts`
- Test: `tests/mcp/server.test.ts`

**Interfaces:**
- Consumes: `readFileText` from `src/tools/read-file.ts`; `createMCPClient` from `@ai-sdk/mcp`; `Experimental_StdioMCPTransport` from `@ai-sdk/mcp/mcp-stdio`.
- Produces:
  - `src/mcp/server.ts` — an MCP server (stdio) registering tool `read_file` (`inputSchema` = raw shape `{ path: z.string() }`), returning `{ content: [{ type: 'text', text }] }`.
  - `src/mcp/client.ts`: `createFileTools(): Promise<{ tools: ToolSet; close: () => Promise<void> }>` — launches the server via `bun run src/mcp/server.ts` and returns its tools + a close fn.

- [ ] **Step 1: Create `src/mcp/server.ts`** (stdout = JSON-RPC only; never `console.log`)

```ts
import { readFileText } from '../tools/read-file.ts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'file-tools', version: '0.1.0' });

server.registerTool(
  'read_file',
  {
    title: 'Read File',
    description: 'Read a UTF-8 text file from disk and return its contents.',
    inputSchema: { path: z.string() }, // RAW shape, not z.object(...)
  },
  async ({ path }) => {
    try {
      return { content: [{ type: 'text', text: await readFileText(path) }] };
    } catch (cause) {
      return {
        content: [
          { type: 'text', text: `Could not read ${path}: ${(cause as Error).message}` },
        ],
        isError: true,
      };
    }
  },
);

await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: Create `src/mcp/client.ts`**

```ts
import type { ToolSet } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';

/** Launch the file-tools MCP server and expose its tools to the agent. */
export async function createFileTools(): Promise<{
  tools: ToolSet;
  close: () => Promise<void>;
}> {
  const client = await createMCPClient({
    transport: new StdioMCPTransport({
      command: 'bun',
      args: ['run', 'src/mcp/server.ts'],
    }),
  });
  const tools = await client.tools();
  return { tools, close: () => client.close() };
}
```

- [ ] **Step 3: Write the integration test** — `tests/mcp/server.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTools } from '../../src/mcp/client.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('MCP server exposes read_file and reads a file end-to-end', async () => {
  const p = join(dir, 'doc.txt');
  await writeFile(p, 'mcp says hi');

  const { tools, close } = await createFileTools();
  try {
    expect(tools.read_file).toBeDefined();
    const result = await tools.read_file.execute!({ path: p }, {} as never);
    const text = JSON.stringify(result);
    expect(text).toContain('mcp says hi');
  } finally {
    await close();
  }
});
```

- [ ] **Step 4: Run the integration test**

Run: `bun run test:file -- ./tests/mcp/server.test.ts`
Expected: PASS (1 test). This spawns the server subprocess via stdio; it needs no Ollama. If the tool result shape differs, assert that the stringified result contains `mcp says hi`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/client.ts tests/mcp/server.test.ts
git commit -m "feat(mcp): expose read_file over mcp and consume via ai sdk client"
```

---

### Task 12: CLI orchestration + entrypoint

**Files:**
- Create: `src/cli/answer-file-question.ts`
- Create: `src/cli/chat.ts`
- Test: `tests/cli/answer-file-question.test.ts`

**Interfaces:**
- Consumes: `runAgent` (`src/core/agent.ts`); `createRun`, `writeArtifact` (`src/run/run-store.ts`); `appendJournal` (`src/run/journal.ts`); `ToolSet`, `LanguageModel` from `ai`.
- Produces:
  - `answerFileQuestion(deps: AnswerDeps): Promise<string>` where
    `type AnswerDeps = { model: LanguageModel; tools: ToolSet; question: string; runsRoot: string; runId: string }`.
    It journals `start`, runs the agent, writes `answer.txt`, journals `answer`, and returns the answer text. (Decoupled from Ollama/MCP so it's testable with the mock model + an in-process tool.)
  - `src/cli/chat.ts` — the real entrypoint wiring: ensure model present (pull if missing) → warm → build MCP tools → `answerFileQuestion` → print → unload.

- [ ] **Step 1: Write the failing test** — `tests/cli/answer-file-question.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { answerFileQuestion } from '../../src/cli/answer-file-question.ts';
import { readJournal } from '../../src/run/journal.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cli-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('answers a question, writes the answer artifact, and journals the run', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'The file is a greeting.' }],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  });
  const tools = {
    read_file: tool({
      description: 'read a file',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => ({ text: `contents of ${path}` }),
    }),
  };

  const answer = await answerFileQuestion({
    model,
    tools,
    question: 'Summarize notes.txt',
    runsRoot: root,
    runId: 'run-1',
  });

  expect(answer).toBe('The file is a greeting.');
  expect(await readFile(join(root, 'run-1', 'answer.txt'), 'utf8')).toBe(
    'The file is a greeting.',
  );
  const journal = await readJournal(join(root, 'run-1'));
  expect(journal.map((e) => e.step)).toEqual(['start', 'answer']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/cli/answer-file-question.test.ts`
Expected: FAIL — cannot resolve `answer-file-question.ts`.

- [ ] **Step 3: Create `src/cli/answer-file-question.ts`**

```ts
import type { LanguageModel, ToolSet } from 'ai';
import { runAgent } from '../core/agent.ts';
import { appendJournal } from '../run/journal.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';

const SYSTEM_PROMPT =
  'You answer questions about local files. Use the read_file tool to read any file you need, then answer concisely.';

export type AnswerDeps = {
  model: LanguageModel;
  tools: ToolSet;
  question: string;
  runsRoot: string;
  runId: string;
};

/** Orchestrate one file-Q&A run: journal, agent, artifact, journal. */
export async function answerFileQuestion(deps: AnswerDeps): Promise<string> {
  const run = await createRun(deps.runsRoot, deps.runId);
  await appendJournal(run.dir, { step: 'start', data: { question: deps.question } });

  const { text } = await runAgent({
    model: deps.model,
    systemPrompt: SYSTEM_PROMPT,
    prompt: deps.question,
    tools: deps.tools,
  });

  await writeArtifact(run, 'answer.txt', text);
  await appendJournal(run.dir, { step: 'answer', data: { text } });
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/cli/answer-file-question.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Create `src/cli/chat.ts`** (the real wiring; verified manually in Step 7)

```ts
import {
  isModelInstalled,
  pullModel,
  unloadModel,
  warmModel,
} from '../resource/ollama-control.ts';
import { fitsBudget, machineBudgetBytes } from '../resource/hardware.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import { createFileTools } from '../mcp/client.ts';
import { answerFileQuestion } from './answer-file-question.ts';
import { ResourceError } from '../core/errors.ts';
import qwenFast from '../../models/qwen-fast.ts';

// qwen3:8b @ Q4_K_M, 8k context — rough footprint for the budget check.
const FOOTPRINT = estimateModelBytes({
  paramsBillions: 8,
  bytesPerWeight: 0.56,
  contextTokens: qwenFast.params.numCtx ?? 8192,
  kvBytesPerToken: 131072,
});

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(' ').trim();
  if (question.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<question about a file>"');
    process.exit(1);
  }

  const budget = machineBudgetBytes();
  if (!fitsBudget(FOOTPRINT, budget)) {
    throw new ResourceError(
      `${qwenFast.model} (~${Math.round(FOOTPRINT / 1e9)}GB) exceeds the GPU budget (~${Math.round(budget / 1e9)}GB)`,
    );
  }

  if (!(await isModelInstalled(qwenFast.model))) {
    console.error(`Pulling ${qwenFast.model} (first run only)...`);
    await pullModel(qwenFast.model);
  }
  await warmModel(qwenFast.model);

  const model = createOllamaModel(qwenFast);
  const { tools, close } = await createFileTools();
  try {
    const answer = await answerFileQuestion({
      model,
      tools,
      question,
      runsRoot: 'runs',
      runId: `run-${process.pid}`,
    });
    console.log(answer);
  } finally {
    await close();
    await unloadModel(qwenFast.model);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Typecheck and lint the whole project**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0 (run `bun run lint -- --write` once to apply formatting if needed).

- [ ] **Step 7: Manual end-to-end verification** (requires Ollama running locally)

Run:
```bash
echo "The quick brown fox jumps over the lazy dog." > /tmp/sample.txt
bun run src/cli/chat.ts "What animal is mentioned in /tmp/sample.txt?"
```
Expected: prints an answer mentioning a fox/dog; `runs/run-<pid>/answer.txt` and `runs/run-<pid>/journal.jsonl` exist. (First run pulls `qwen3:8b`, which takes a while.) If Ollama isn't installed, this step is skipped — all unit/integration tests above pass without it.

- [ ] **Step 8: Run the full test suite**

Run: `bun run test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/cli/answer-file-question.ts src/cli/chat.ts tests/cli/answer-file-question.test.ts
git commit -m "feat(cli): wire file-qa agent end-to-end with autonomous warm-up/unload"
```

---

## Self-Review

**1. Spec coverage (slice 1 DoD from §11 + §9 of the design):**
- Basic file Q&A/summarizer agent → Tasks 8, 10, 12. ✓
- Budget check → Task 4 + Task 12 Step 5. ✓
- Pull-if-missing (no hardcoded list in logic; declaration is data) → Tasks 5, 9, 12. ✓
- Warm model → Task 5 + Task 12. ✓
- `read_file` **MCP** tool, consumed via AI SDK MCP client → Tasks 8, 11. ✓
- AI SDK loop with `stopWhen: stepCountIs` guard → Task 10. ✓
- Run dir + journal → Tasks 6, 7, 12. ✓
- Unload after run → Task 5 + Task 12. ✓
- Tested with the mock model → Tasks 10, 12. ✓
- `bun run typecheck` + `bun run lint` clean → Task 1 + Task 12 Step 6. ✓
- No supervisor / multi-model / discovery / Codex → correctly absent (those are slices 2–4). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `ModelDeclaration`/`ProviderKind`/`ModelParams` (Task 2) are consumed unchanged by Tasks 9 and 12. `runAgent`'s `RunAgentInput` (Task 10) matches the call in Task 12. `RunHandle` (Task 7) is used by `writeArtifact` consistently. `createFileTools` returns `{ tools, close }` (Task 11) consumed exactly in Task 12. Tool key `read_file` matches across the mock tests, the MCP server registration, and the agent. ✓

**Two known fragility notes carried into steps (not blockers):** (a) the mock model's `finishReason`/`usage` object shape can tighten across 6.x — Tasks 10/12 note how to adjust to the installed type; (b) `model.modelId` assertion in Task 9 has a documented fallback. Both are flagged inline.
