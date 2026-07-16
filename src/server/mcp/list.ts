import { McpListResponseSchema } from '../../contracts/index.ts';
import { loadMcpConfig } from '../../mcp/config.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../mcp/mcp-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { McpMountStatus } from './mount-status.ts';

export type McpListDeps = {
  mcpConfigPath: string;
  mcpMountStatus: McpMountStatus;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `GET /api/mcp` — every configured server (active + dormant), joined with
 * the addressable mount-status snapshot (Task 20). No engine state is
 * touched (a file read + an in-memory map lookup), so per D8 this route
 * does NOT mint an ephemeral run — there's no span to place. Wrapped in
 * `McpListResponseSchema` (`{ items: McpServerDTO[] }`, Task 6), matching
 * the sibling `GET /api/crews`/`/api/workflows`/`/api/models` handlers'
 * `XxxResponseSchema.parse({ items })` idiom.
 */
export function handleMcpList(deps: McpListDeps): Response {
  const cfg = loadMcpConfig(deps.mcpConfigPath);
  const active = cfg.entries.map((e) =>
    mapMcpEntryToDto(e, deps.mcpMountStatus.get(e.name)),
  );
  const dormant = cfg.dormant.map(mapMcpDormantToDto);
  return json(
    McpListResponseSchema.parse({ items: [...active, ...dormant] }),
    200,
  );
}
