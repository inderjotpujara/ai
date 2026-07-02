### Task 2: Consent store + hashing + prompt flow

**Files:**
- Create: `src/mcp/consent.ts`
- Test: `tests/mcp/consent.test.ts`

**Interfaces:**
- Consumes: `McpServerEntry`, `McpTransportKind` (Task 1); `LineInput`/`askYesNo` (`src/provisioning/ui/prompt.ts`); `node:crypto`, `node:fs`.
- Produces:
  - `specHash(entry: McpServerEntry): string` — sha256 over canonical raw fields: stdio `{command,args,envKeys(sorted)}`, http `{url,headerNames(sorted)}` from the RAW config (unexpanded — no secret values).
  - `toolsHash(tools: ToolSet): string` — sha256 over sorted `name|description|inputSchemaJson` triples.
  - `type ApprovalRecord = { specHash: string; toolsHash?: string; approvedAt: string; declined?: boolean }`
  - `readApprovals(path?: string): Record<string, ApprovalRecord>` / `writeApprovals(store, path?): void` (atomic temp+rename; default path `join(process.cwd(), '.mcp-approvals.json')`)
  - `describeEntry(entry: McpServerEntry): string` — the exact untruncated raw command line or URL + header names.
  - `dangerFlags(entry: McpServerEntry): string[]`
  - `type ConsentDeps = { store: Record<string, ApprovalRecord>; ask: (q: string) => Promise<boolean>; isTTY: boolean; autoYes: boolean; warn: (msg: string) => void }`
  - `ensureConsent(entry: McpServerEntry, deps: ConsentDeps): Promise<boolean>` — mutates `deps.store`; caller persists.
  - `pinTools(store, name, hash): void`; `checkDrift(store, name, hash): boolean` (true = drift).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mcp/consent.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ApprovalRecord,
  checkDrift,
  dangerFlags,
  describeEntry,
  ensureConsent,
  pinTools,
  readApprovals,
  specHash,
  toolsHash,
  writeApprovals,
} from '../../src/mcp/consent.ts';
import { type McpServerEntry, McpTransportKind } from '../../src/mcp/types.ts';

const stdio: McpServerEntry = {
  kind: McpTransportKind.Stdio, name: 'ft', command: 'bun',
  args: ['run', 's.ts'], env: {}, raw: { command: 'bun', args: ['run', 's.ts'] },
};
const http: McpServerEntry = {
  kind: McpTransportKind.Http, name: 'gh', url: 'https://x.test/mcp',
  headers: { Authorization: 'Bearer SECRET' },
  raw: { type: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer ${T}' } },
};

describe('specHash', () => {
  it('is stable and ignores header VALUES', () => {
    const other = { ...http, headers: { Authorization: 'Bearer DIFFERENT' } };
    expect(specHash(http)).toBe(specHash(other));
  });
  it('changes when the command changes', () => {
    expect(specHash(stdio)).not.toBe(specHash({ ...stdio, command: 'sh', raw: { command: 'sh' } }));
  });
});

describe('toolsHash', () => {
  it('changes when a description changes (rug-pull signal)', () => {
    const a = toolsHash({ t: { description: 'safe', inputSchema: undefined } } as never);
    const b = toolsHash({ t: { description: 'EVIL', inputSchema: undefined } } as never);
    expect(a).not.toBe(b);
  });
});

describe('approval store', () => {
  it('round-trips atomically and degrades on missing file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mcp-appr-')), '.mcp-approvals.json');
    expect(readApprovals(path)).toEqual({});
    const store: Record<string, ApprovalRecord> = {
      ft: { specHash: 'h', approvedAt: '2026-07-02T00:00:00Z' },
    };
    writeApprovals(store, path);
    expect(readApprovals(path)).toEqual(store);
  });
});

describe('ensureConsent', () => {
  const deps = (over: Partial<Parameters<typeof ensureConsent>[1]>) => ({
    store: {}, ask: async () => true, isTTY: true, autoYes: false, warn: () => {}, ...over,
  });
  it('prompts and records approval on first mount', async () => {
    const d = deps({});
    expect(await ensureConsent(stdio, d)).toBe(true);
    expect(d.store.ft?.specHash).toBe(specHash(stdio));
  });
  it('skips silently-approved on matching hash without re-prompting', async () => {
    let asked = 0;
    const d = deps({
      store: { ft: { specHash: specHash(stdio), approvedAt: 'x' } },
      ask: async () => { asked++; return true; },
    });
    expect(await ensureConsent(stdio, d)).toBe(true);
    expect(asked).toBe(0);
  });
  it('re-prompts when the spec hash changed', async () => {
    let asked = 0;
    const d = deps({
      store: { ft: { specHash: 'stale', approvedAt: 'x' } },
      ask: async () => { asked++; return true; },
    });
    await ensureConsent(stdio, d);
    expect(asked).toBe(1);
  });
  it('remembers a decline and does not re-prompt on same spec', async () => {
    const d = deps({ ask: async () => false });
    expect(await ensureConsent(stdio, d)).toBe(false);
    expect(d.store.ft?.declined).toBe(true);
    let asked = 0;
    const d2 = deps({ store: d.store, ask: async () => { asked++; return true; } });
    expect(await ensureConsent(stdio, d2)).toBe(false);
    expect(asked).toBe(0);
  });
  it('non-TTY without autoYes skips (returns false) and never asks', async () => {
    let asked = 0;
    const d = deps({ isTTY: false, ask: async () => { asked++; return true; } });
    expect(await ensureConsent(stdio, d)).toBe(false);
    expect(asked).toBe(0);
    expect(d.store.ft).toBeUndefined(); // a skip is not a decline
  });
  it('autoYes approves without prompting (headless opt-in)', async () => {
    const d = deps({ isTTY: false, autoYes: true, ask: async () => false });
    expect(await ensureConsent(stdio, d)).toBe(true);
  });
});

describe('drift pinning', () => {
  it('pinTools records, checkDrift detects a change', () => {
    const store: Record<string, ApprovalRecord> = { ft: { specHash: 'h', approvedAt: 'x' } };
    pinTools(store, 'ft', 'toolsA');
    expect(checkDrift(store, 'ft', 'toolsA')).toBe(false);
    expect(checkDrift(store, 'ft', 'toolsB')).toBe(true);
  });
});

describe('display + danger', () => {
  it('describeEntry shows raw command and never header values', () => {
    expect(describeEntry(stdio)).toContain('bun run s.ts');
    const d = describeEntry(http);
    expect(d).toContain('https://x.test/mcp');
    expect(d).not.toContain('SECRET');
  });
  it('flags dangerous patterns', () => {
    const risky: McpServerEntry = {
      kind: McpTransportKind.Stdio, name: 'r', command: 'sudo',
      args: ['rm', '-rf', '/'], env: {}, raw: {},
    };
    expect(dangerFlags(risky).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/mcp/consent.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `src/mcp/consent.ts`**

```ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolSet } from 'ai';
import { type McpServerEntry, McpTransportKind } from './types.ts';

export type ApprovalRecord = {
  specHash: string;
  toolsHash?: string;
  approvedAt: string;
  declined?: boolean;
};

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Hash the server's identity from RAW config fields — env/header NAMES only,
 *  never values, so secrets are neither hashed nor stored. */
export function specHash(entry: McpServerEntry): string {
  if (entry.kind === McpTransportKind.Http) {
    const raw = entry.raw as { url?: string; headers?: Record<string, string> };
    return sha256(JSON.stringify({
      url: raw.url ?? entry.url,
      headerNames: Object.keys(raw.headers ?? {}).sort(),
    }));
  }
  const raw = entry.raw as { command?: string; args?: string[]; env?: Record<string, string> };
  return sha256(JSON.stringify({
    command: raw.command ?? entry.command,
    args: raw.args ?? entry.args,
    envKeys: Object.keys(raw.env ?? {}).sort(),
  }));
}

/** Hash the mounted tool definitions — the rug-pull pin. */
export function toolsHash(tools: ToolSet): string {
  const parts = Object.entries(tools)
    .map(([name, t]) => {
      let schema = '';
      try {
        const s = (t as { inputSchema?: { jsonSchema?: unknown } }).inputSchema;
        schema = JSON.stringify(s?.jsonSchema ?? null);
      } catch {
        schema = 'unserializable';
      }
      return `${name}|${(t as { description?: string }).description ?? ''}|${schema}`;
    })
    .sort();
  return sha256(parts.join('\n'));
}

export function approvalsPath(): string {
  return join(process.cwd(), '.mcp-approvals.json');
}

export function readApprovals(
  path: string = approvalsPath(),
): Record<string, ApprovalRecord> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, ApprovalRecord>;
  } catch {
    return {}; // corrupt store → re-consent, never crash
  }
}

/** Atomic write (temp + rename) so a failure never corrupts the trust store. */
export function writeApprovals(
  store: Record<string, ApprovalRecord>,
  path: string = approvalsPath(),
): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, path);
}

/** The exact, untruncated thing that will run — from RAW config (unexpanded),
 *  so secrets injected via ${VAR} are never displayed. */
export function describeEntry(entry: McpServerEntry): string {
  if (entry.kind === McpTransportKind.Http) {
    const raw = entry.raw as { url?: string; headers?: Record<string, string> };
    const names = Object.keys(raw.headers ?? {});
    return `${raw.url ?? entry.url}${names.length > 0 ? `  (headers: ${names.join(', ')})` : ''}`;
  }
  const raw = entry.raw as { command?: string; args?: string[] };
  return [raw.command ?? entry.command, ...(raw.args ?? entry.args)].join(' ');
}

const DANGER_PATTERNS: [RegExp, string][] = [
  [/\bsudo\b/, 'runs as sudo'],
  [/\brm\s+-rf?\b/, 'recursive delete'],
  [/curl[^|]*\|\s*(ba|z)?sh/, 'pipes a download into a shell'],
  [/wget[^|]*\|\s*(ba|z)?sh/, 'pipes a download into a shell'],
];

export function dangerFlags(entry: McpServerEntry): string[] {
  const text = describeEntry(entry);
  return DANGER_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

export type ConsentDeps = {
  store: Record<string, ApprovalRecord>;
  ask: (question: string) => Promise<boolean>;
  isTTY: boolean;
  autoYes: boolean;
  warn: (msg: string) => void;
};

/** Consent gate for one entry. Mutates deps.store; the caller persists it.
 *  Non-TTY without autoYes = skip (false) with a warning — NEVER a hang. */
export async function ensureConsent(
  entry: McpServerEntry,
  deps: ConsentDeps,
): Promise<boolean> {
  const hash = specHash(entry);
  const existing = deps.store[entry.name];
  if (existing?.specHash === hash) return !existing.declined;
  if (deps.autoYes) {
    deps.store[entry.name] = { specHash: hash, approvedAt: new Date().toISOString() };
    return true;
  }
  if (!deps.isTTY) {
    deps.warn(`MCP server "${entry.name}" is not approved yet and this is not a TTY — skipping (run interactively or set AGENT_MCP_AUTO_APPROVE=1)`);
    return false;
  }
  const flags = dangerFlags(entry);
  const danger = flags.length > 0 ? `\n  ⚠ ${flags.join('; ')}` : '';
  const changed = existing ? ' (configuration CHANGED since last approval)' : '';
  const ok = await deps.ask(
    `Mount MCP server "${entry.name}"${changed}?\n  ${describeEntry(entry)}${danger}\n  It will run with this process's privileges.`,
  );
  deps.store[entry.name] = {
    specHash: hash,
    approvedAt: new Date().toISOString(),
    ...(ok ? {} : { declined: true }),
  };
  return ok;
}

export function pinTools(
  store: Record<string, ApprovalRecord>,
  name: string,
  hash: string,
): void {
  const rec = store[name];
  if (rec) rec.toolsHash = hash;
}

/** True when the server's tool definitions changed since they were pinned. */
export function checkDrift(
  store: Record<string, ApprovalRecord>,
  name: string,
  hash: string,
): boolean {
  const pinned = store[name]?.toolsHash;
  return pinned !== undefined && pinned !== hash;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/mcp/consent.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Add `.mcp-approvals.json` to `.gitignore`**

Append to `.gitignore` (after the `# Misc` block):

```
# MCP mount trust store (machine-local approvals; never committed). See docs/architecture.md §14
.mcp-approvals.json
```

- [ ] **Step 6: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint:file -- "src/mcp/consent.ts" "tests/mcp/consent.test.ts"`
Expected: clean.

```bash
git add src/mcp/consent.ts tests/mcp/consent.test.ts .gitignore
git commit -m "feat(mcp): consent-on-mount store with spec hashing + tool-definition pinning (Slice 15 Task 2)"
```

---

