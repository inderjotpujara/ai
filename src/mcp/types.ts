import { z } from 'zod';

export enum McpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
}

/** Raw per-entry schemas — the standard mcpServers shape + our `agents` extension. */
export const stdioEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  agents: z.array(z.string()).optional(),
});

export const httpEntrySchema = z.object({
  type: z.enum(['http', 'streamable-http', 'sse']), // aliases tolerated; all mount as HTTP
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
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
