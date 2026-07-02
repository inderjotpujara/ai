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
    if (!raw.url)
      throw new Error(`malformed raw config for MCP server "${entry.name}"`);
    return sha256(
      JSON.stringify({
        url: raw.url,
        headerNames: Object.keys(raw.headers ?? {}).sort(),
      }),
    );
  }
  const raw = entry.raw as {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };
  if (!raw.command)
    throw new Error(`malformed raw config for MCP server "${entry.name}"`);
  return sha256(
    JSON.stringify({
      command: raw.command,
      args: raw.args,
      envKeys: Object.keys(raw.env ?? {}).sort(),
    }),
  );
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
      // JSON-serialize field array: delimiter injection impossible, schema already JSON.
      return JSON.stringify([
        name,
        (t as { description?: string }).description ?? '',
        schema,
      ]);
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
    return JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      ApprovalRecord
    >;
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
    if (!raw.url)
      throw new Error(`malformed raw config for MCP server "${entry.name}"`);
    const names = Object.keys(raw.headers ?? {});
    return `${raw.url}${names.length > 0 ? `  (headers: ${names.join(', ')})` : ''}`;
  }
  const raw = entry.raw as { command?: string; args?: string[] };
  if (!raw.command)
    throw new Error(`malformed raw config for MCP server "${entry.name}"`);
  return [raw.command, ...(raw.args ?? [])].join(' ');
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
    deps.store[entry.name] = {
      specHash: hash,
      approvedAt: new Date().toISOString(),
    };
    return true;
  }
  if (!deps.isTTY) {
    deps.warn(
      `MCP server "${entry.name}" is not approved yet and this is not a TTY — skipping (run interactively or set AGENT_MCP_AUTO_APPROVE=1)`,
    );
    return false;
  }
  const flags = dangerFlags(entry);
  const danger = flags.length > 0 ? `\n  ⚠ ${flags.join('; ')}` : '';
  const changed = existing
    ? ' (configuration CHANGED since last approval)'
    : '';
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
