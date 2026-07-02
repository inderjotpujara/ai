import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  httpEntrySchema,
  type McpConfig,
  type McpServerEntry,
  McpTransportKind,
  stdioEntrySchema,
} from './types.ts';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

const isHttpLike = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && ('url' in v || 'type' in v);

/** Expand ${VAR} / ${VAR:-default}; report vars that are unset with no default. */
export function expandVars(
  value: string,
  env: Record<string, string | undefined> = process.env,
): { value: string; missing: string[] } {
  const missing: string[] = [];
  const out = value.replace(VAR_PATTERN, (_m, name: string, def?: string) => {
    const v = env[name];
    if (v !== undefined) return v;
    if (def !== undefined) return def;
    missing.push(name);
    return '';
  });
  return { value: out, missing };
}

function expandRecord(
  rec: Record<string, string>,
  env: Record<string, string | undefined>,
  missing: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    const e = expandVars(v, env);
    missing.push(...e.missing);
    out[k] = e.value;
  }
  return out;
}

export function defaultConfigPath(): string {
  return process.env.AGENT_MCP_CONFIG ?? join(process.cwd(), 'mcp.json');
}

/** Load + validate mcp.json. Per-entry degrade: a bad entry warns and is
 *  skipped; entries with unset env vars are dormant; never throws. */
export function loadMcpConfig(
  path: string = defaultConfigPath(),
  env: Record<string, string | undefined> = process.env,
): McpConfig {
  const cfg: McpConfig = { entries: [], dormant: [], warnings: [] };
  if (!existsSync(path)) {
    cfg.warnings.push(`mcp.json not found at ${path} — no MCP servers mounted`);
    return cfg;
  }
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (cause) {
    cfg.warnings.push(
      `mcp.json at ${path} is not valid JSON (${(cause as Error).message})`,
    );
    return cfg;
  }
  let servers = root.mcpServers as Record<string, unknown> | undefined;
  if (!servers && root.servers) {
    servers = root.servers as Record<string, unknown>;
    cfg.warnings.push(
      'mcp.json uses a VS-Code-style "servers" root; reading it as mcpServers',
    );
  }
  if (!servers || typeof servers !== 'object') {
    cfg.warnings.push('mcp.json has no mcpServers object — nothing to mount');
    return cfg;
  }
  for (const [name, raw] of Object.entries(servers)) {
    const schema = isHttpLike(raw) ? httpEntrySchema : stdioEntrySchema;
    const fallback =
      schema === httpEntrySchema ? stdioEntrySchema : httpEntrySchema;
    let parseResult = schema.safeParse(raw);
    if (!parseResult.success) {
      const secondResult = fallback.safeParse(raw);
      if (secondResult.success) {
        parseResult = secondResult;
      } else {
        const issue = parseResult.error.issues[0];
        const where = issue?.path?.length
          ? ` at "${issue.path.join('.')}"`
          : '';
        cfg.warnings.push(
          `mcp.json entry "${name}" is invalid and was skipped:${where} ${issue?.message ?? 'schema mismatch'}`,
        );
        continue;
      }
    }
    const missing: string[] = [];
    const entry = toEntry(name, parseResult.data, raw, env, missing);
    if (missing.length > 0) {
      cfg.dormant.push({ name, missingVars: [...new Set(missing)] });
      continue;
    }
    cfg.entries.push(entry);
  }
  return cfg;
}

function toEntry(
  name: string,
  data:
    | import('zod').infer<typeof httpEntrySchema>
    | import('zod').infer<typeof stdioEntrySchema>,
  raw: unknown,
  env: Record<string, string | undefined>,
  missing: string[],
): McpServerEntry {
  if ('url' in data) {
    const url = expandVars(data.url, env);
    missing.push(...url.missing);
    return {
      kind: McpTransportKind.Http,
      name,
      url: url.value,
      headers: expandRecord(data.headers ?? {}, env, missing),
      agents: data.agents,
      raw,
    };
  }
  const command = expandVars(data.command, env);
  missing.push(...command.missing);
  const args = (data.args ?? []).map((a) => {
    const e = expandVars(a, env);
    missing.push(...e.missing);
    return e.value;
  });
  return {
    kind: McpTransportKind.Stdio,
    name,
    command: command.value,
    args,
    env: expandRecord(data.env ?? {}, env, missing),
    agents: data.agents,
    raw,
  };
}
