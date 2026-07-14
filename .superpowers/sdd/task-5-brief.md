### Task 5: Config — `ConfigEntry.strict?` flag + server (`AGENT_WEB_*`) entries

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/config/web-config.test.ts`

**Interfaces:**
- Consumes: existing `ConfigEntry`, `CONFIG_SPEC`, `loadConfig` from `src/config/schema.ts`.
- Produces: `ConfigEntry` gains optional `strict?: boolean`; three new entries `AGENT_WEB_PORT` (number, 4130), `AGENT_WEB_ORIGIN_ALLOWLIST` (string), `AGENT_WEB_RECORD_IO` (boolean, false, `strict: true`); `strict: true` added to `AGENT_MCP_AUTO_APPROVE` and `AGENT_PROVISION_AUTO_YES`. No behavior change in `coerce`/`loadConfig`.

- [ ] **Step 1: Write the failing config test**

```ts
// tests/config/web-config.test.ts
import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

const byEnv = (env: string) => CONFIG_SPEC.find((e) => e.env === env);

test('the three AGENT_WEB_* entries exist with documented defaults', () => {
  expect(byEnv('AGENT_WEB_PORT')?.def).toBe(4130);
  expect(byEnv('AGENT_WEB_ORIGIN_ALLOWLIST')?.kind).toBe('string');
  expect(byEnv('AGENT_WEB_RECORD_IO')?.def).toBe(false);
});

test('strict flag marks the === "1" default-off booleans', () => {
  expect(byEnv('AGENT_WEB_RECORD_IO')?.strict).toBe(true);
  expect(byEnv('AGENT_MCP_AUTO_APPROVE')?.strict).toBe(true);
  expect(byEnv('AGENT_PROVISION_AUTO_YES')?.strict).toBe(true);
  // A default-on boolean carries no strict flag.
  expect(byEnv('AGENT_TELEMETRY_RECORD_IO')?.strict).toBeUndefined();
});

test('loadConfig behavior is unchanged: web record-IO defaults off, env overrides', () => {
  expect(loadConfig({}).values.AGENT_WEB_RECORD_IO).toBe(false);
  expect(loadConfig({ AGENT_WEB_RECORD_IO: '1' }).values.AGENT_WEB_RECORD_IO).toBe(true);
  expect(loadConfig({ AGENT_WEB_PORT: '5555' }).values.AGENT_WEB_PORT).toBe(5555);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config/web-config.test.ts`
Expected: FAIL — `AGENT_WEB_PORT` entry not found (`?.def` is `undefined`).

- [ ] **Step 3: Add the `strict?` flag to the `ConfigEntry` type**

In `src/config/schema.ts`, replace the `ConfigEntry` type:

```ts
export type ConfigEntry = {
  env: string;
  kind: ConfigKind;
  def: number | boolean | string;
  doc: string;
  /**
   * Marks a default-OFF boolean whose REAL read site uses a stricter `=== '1'`
   * check (e.g. AGENT_MCP_AUTO_APPROVE, AGENT_PROVISION_AUTO_YES). The schema
   * `coerce` rule below is unchanged (any non-`0`/`false` reads true); this flag
   * only lets a future settings UI surface the stricter real-world semantics.
   */
  strict?: boolean;
};
```

- [ ] **Step 4: Add `strict: true` to the two existing default-off booleans**

In `src/config/schema.ts`, the `AGENT_PROVISION_AUTO_YES` entry — add the flag:

```ts
  {
    env: 'AGENT_PROVISION_AUTO_YES',
    kind: 'boolean',
    def: false,
    doc: "Non-interactive auto-confirm for model provisioning prompts; real code only checks '1' exactly (cli/provision.ts, cli/chat.ts).",
    strict: true,
  },
```

The `AGENT_MCP_AUTO_APPROVE` entry — add the flag:

```ts
  {
    env: 'AGENT_MCP_AUTO_APPROVE',
    kind: 'boolean',
    def: false,
    doc: "Non-interactive auto-approve for new MCP server consent; real code only checks '1' exactly (mcp/mount.ts).",
    strict: true,
  },
```

- [ ] **Step 5: Add the server (web BFF) config group**

In `src/config/schema.ts`, insert a new group in `CONFIG_SPEC` immediately before the closing `];`:

```ts
  // --- Server / web BFF (Slice 30b) ---
  {
    env: 'AGENT_WEB_PORT',
    kind: 'number',
    def: 4130,
    doc: 'Port the local web BFF (bun run web) listens on (server/main.ts). Distinct from Ollama :11434 (bun run serve).',
  },
  {
    env: 'AGENT_WEB_ORIGIN_ALLOWLIST',
    kind: 'string',
    def: 'http://localhost,http://127.0.0.1',
    doc: 'Comma-separated extra allowed Origins beyond localhost/127.0.0.1:PORT; config-driven so a Slice-24 tunnel can add its origin (server/security/origin.ts).',
  },
  {
    env: 'AGENT_WEB_RECORD_IO',
    kind: 'boolean',
    def: false,
    doc: "Record prompt/response IO into spans for SERVED (web) runs; default OFF, only '1' enables (D17). Distinct from AGENT_TELEMETRY_RECORD_IO (CLI, default on).",
    strict: true,
  },
```

- [ ] **Step 6: Run config test + typecheck to verify pass**

Run: `bun test tests/config/web-config.test.ts && bun run typecheck`
Expected: PASS (3 tests) and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts tests/config/web-config.test.ts
git commit -m "feat(config): add ConfigEntry.strict flag + AGENT_WEB_* server entries"
```

---

