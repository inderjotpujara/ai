import { z } from 'zod';

export enum McpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
}

/** How a remote HTTP server authenticates. `Static` (the default, implicit
 *  when `auth` is absent) sends fixed `headers` (PAT/API key from env, as
 *  today). `OAuth` marks the entry as wanting an `authProvider` — the actual
 *  provider instance is supplied by the caller (deps.authProviders in
 *  mount.ts), never by JSON config, since it's a stateful runtime object.
 *  Live OAuth token exchange is deferred (contract-tested only — see
 *  docs/architecture.md §14). */
export enum McpAuthKind {
  Static = 'static',
  OAuth = 'oauth',
}

/** Raw per-entry schemas — the standard mcpServers shape + our `agents` extension. */
export const stdioEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  agents: z.array(z.string()).optional(),
});

export const httpAuthSchema = z.object({
  kind: z.literal(McpAuthKind.OAuth),
  scopes: z.array(z.string()).optional(),
  clientId: z.string().optional(),
});

export const httpEntrySchema = z.object({
  type: z.enum(['http', 'streamable-http', 'sse']), // aliases tolerated; all mount as HTTP
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  auth: httpAuthSchema.optional(),
  agents: z.array(z.string()).optional(),
});

export const serverEntrySchema = z.union([httpEntrySchema, stdioEntrySchema]);

/** A validated, env-expanded server entry ready to mount. `raw` keeps the
 *  as-written config value for consent display + spec hashing (never expanded). */
export type StdioServerEntry = {
  kind: McpTransportKind.Stdio;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  agents?: string[];
  raw: unknown;
};

export type HttpServerEntry = {
  kind: McpTransportKind.Http;
  name: string;
  url: string;
  headers: Record<string, string>;
  /** Absent = static-header auth (default, unchanged). Present = the entry
   *  wants an OAuth authProvider (see McpAuthKind doc above). `scopes` /
   *  `clientId` are optional hints forwarded to the OAuth provider
   *  constructor (Task 14); absent means provider-side defaults apply. */
  auth?: { kind: McpAuthKind.OAuth; scopes?: string[]; clientId?: string };
  agents?: string[];
  raw: unknown;
};

export type McpServerEntry = StdioServerEntry | HttpServerEntry;

export type McpConfig = {
  entries: McpServerEntry[];
  dormant: { name: string; missingVars: string[] }[];
  warnings: string[];
};

/** A curated starter-pack entry: the raw server value plus builder-queryable metadata. */
export type PackEntry = {
  name: string;
  description: string;
  capabilities: string[];
  requiresEnv?: string[];
  /** The value to write under mcpServers.<name> in mcp.json (raw, unexpanded). */
  server: Record<string, unknown>;
};
