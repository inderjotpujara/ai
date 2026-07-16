import {
  McpAddRequestSchema,
  type McpServerDTO,
} from '../../contracts/index.ts';
import { loadMcpConfig } from '../../mcp/config.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../mcp/mcp-dto.ts';
import { writeMcpEntry } from '../../mcp/write.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { McpMountStatus } from './mount-status.ts';

export type McpAddDeps = {
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
 * `POST /api/mcp/add` — validates the raw server value, writes it into
 * `mcp.json` (`writeMcpEntry`), then RE-LOADS the config so the response
 * reflects the actual parsed/expanded entry (dormant-if-missing-env,
 * transport kind, etc.) instead of echoing the raw input back. No engine
 * state beyond a file write is touched — D8's ephemeral-run rule is for
 * routes that call INTO the memory/MCP-mount engines, not config edits.
 */
export async function handleMcpAdd(
  req: Request,
  deps: McpAddDeps,
): Promise<Response> {
  let body: ReturnType<typeof McpAddRequestSchema.parse>;
  try {
    body = McpAddRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid mcp add request' }, 400);
  }

  const result = await writeMcpEntry(
    body.name,
    body.server,
    deps.mcpConfigPath,
  );
  if (!result.ok) return json({ error: result.message }, 409);

  const cfg = loadMcpConfig(deps.mcpConfigPath);
  const entry = cfg.entries.find((e) => e.name === body.name);
  const dormant = cfg.dormant.find((d) => d.name === body.name);
  const dto: McpServerDTO | undefined = entry
    ? mapMcpEntryToDto(entry, deps.mcpMountStatus.get(entry.name))
    : dormant
      ? mapMcpDormantToDto(dormant)
      : undefined;
  if (!dto)
    return json({ error: 'entry written but could not be re-read' }, 500);
  return json(dto, 200);
}
