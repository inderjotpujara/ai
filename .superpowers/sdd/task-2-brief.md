### Task 2: Central config schema + `bun run config`

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/cli/config.ts`
- Create: `tests/config/schema.test.ts`
- Modify: `package.json` (add `"config": "bun run src/cli/config.ts"` script)
- Modify: `src/cli/chat.ts` (call `loadConfig()` once at the top of `main` to fail-fast on an invalid env value)

**Interfaces:**
- Produces:
  - `CONFIG_SPEC: ConfigEntry[]` where `type ConfigEntry = { env: string; kind: 'number'|'boolean'|'string'; def: number|boolean|string; doc: string }` — the single documented source of truth for every `AGENT_*` knob.
  - `loadConfig(env?: Record<string,string|undefined>): { values: Record<string, number|boolean|string>; sources: Record<string,'env'|'default'> }` — coerces + validates each entry (invalid → default, mirroring `envNumber`), returns effective values + where each came from.
  - Note (scope): this task establishes the schema + validation + dump; migrating the ~63 existing scattered read sites to read from `loadConfig` is a **follow-on** (tracked in the ops-surface follow-ups), not done here — the schema is the documented contract now.

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/schema.test.ts
import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

test('every entry has a doc string and a default', () => {
  for (const e of CONFIG_SPEC) { expect(e.doc.length).toBeGreaterThan(0); expect(e.def).toBeDefined(); }
});
test('loadConfig applies defaults and records source', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});
test('a valid env override wins and is marked env', () => {
  const { values, sources } = loadConfig({ AGENT_MAX_DELEGATION_DEPTH: '8' });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(8);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('env');
});
test('an invalid number falls back to the default (env-fallback-only rule)', () => {
  const { values, sources } = loadConfig({ AGENT_MAX_DELEGATION_DEPTH: 'notanumber' });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the spec + loader**

```ts
// src/config/schema.ts
export type ConfigKind = 'number' | 'boolean' | 'string';
export type ConfigEntry = { env: string; kind: ConfigKind; def: number | boolean | string; doc: string };

// The documented source of truth for every AGENT_* knob. Enumerate ALL of them
// (the full 63-var list is in the Slice-30a spec + the extraction report). Sample below;
// the implementer transcribes the complete list, grouped by concern, one entry each.
export const CONFIG_SPEC: ConfigEntry[] = [
  { env: 'AGENT_MAX_DELEGATION_DEPTH', kind: 'number', def: 5, doc: 'Max router→specialist delegation depth.' },
  { env: 'AGENT_RUN_TIMEOUT_MS', kind: 'number', def: 120_000, doc: 'Hard wall-clock cap per agent run.' },
  { env: 'AGENT_IDLE_TIMEOUT_MS', kind: 'number', def: 90_000, doc: 'Idle-stall timeout.' },
  { env: 'AGENT_MEMORY_TOP_K', kind: 'number', def: 6, doc: 'Default recall top-K.' },
  { env: 'AGENT_MEMORY_RERANK', kind: 'boolean', def: true, doc: 'Enable reranking on recall.' },
  { env: 'AGENT_TELEMETRY_RECORD_IO', kind: 'boolean', def: true, doc: 'Record prompts/responses into run spans.' },
  { env: 'AGENT_UNCENSORED', kind: 'boolean', def: true, doc: 'Allow uncensored models + disable image safety checker.' },
  { env: 'AGENT_RUNS_ROOT', kind: 'string', def: 'runs', doc: 'Directory for run artifacts/traces.' },
  { env: 'AGENT_LOG_LEVEL', kind: 'string', def: 'info', doc: 'Logger threshold: debug|info|warn|error.' },
  // … transcribe the remaining ~54 AGENT_* vars here, grouped (reliability, memory,
  //   media, voice, verify, provisioning, breaker, mcp, otlp, etc.) …
];

function coerce(entry: ConfigEntry, raw: string | undefined): { value: number | boolean | string; source: 'env' | 'default' } {
  if (raw === undefined || raw === '') return { value: entry.def, source: 'default' };
  if (entry.kind === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n, source: 'env' } : { value: entry.def, source: 'default' };
  }
  if (entry.kind === 'boolean') return { value: raw !== '0' && raw.toLowerCase() !== 'false', source: 'env' };
  return { value: raw, source: 'env' };
}
export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const values: Record<string, number | boolean | string> = {};
  const sources: Record<string, 'env' | 'default'> = {};
  for (const e of CONFIG_SPEC) { const { value, source } = coerce(e, env[e.env]); values[e.env] = value; sources[e.env] = source; }
  return { values, sources };
}
```

```ts
// src/cli/config.ts
import { CONFIG_SPEC, loadConfig } from '../config/schema.ts';
function main() {
  const { values, sources } = loadConfig();
  for (const e of CONFIG_SPEC) {
    const src = sources[e.env] === 'env' ? 'env ' : 'def ';
    process.stdout.write(`${src} ${e.env.padEnd(32)} ${String(values[e.env]).padEnd(12)} ${e.doc}\n`);
  }
}
if (import.meta.main) main();
```

- [ ] **Step 4: Wire fail-fast + script**

Add `"config": "bun run src/cli/config.ts"` to `package.json` scripts. In `src/cli/chat.ts` `main`, add `loadConfig();` near the top (validates the environment eagerly; today it's lazy per-read).

Run: `bun test tests/config/ && bun run config | head -5 && bun run typecheck`
Expected: tests PASS; `bun run config` prints the effective table.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/cli/config.ts tests/config/schema.test.ts package.json src/cli/chat.ts
git commit -m "feat(config): single documented AGENT_* schema + 'bun run config' dump (was 63 scattered env reads)"
```

---

