import { expect, test } from 'bun:test';
import {
  McpAuthKind,
  McpServerStatus,
  McpTransportKind,
} from '../../src/contracts/index.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../src/mcp/mcp-dto.ts';
import {
  McpAuthKind as EngineAuthKind,
  McpTransportKind as EngineKind,
  type HttpServerEntry,
  type StdioServerEntry,
} from '../../src/mcp/types.ts';

test('mapMcpEntryToDto: a never-mounted static stdio entry reads "skipped" with a hint', () => {
  const entry: StdioServerEntry = {
    kind: EngineKind.Stdio,
    name: 'read_file',
    command: 'bun',
    args: ['run', 'src/mcp/server.ts'],
    env: {},
    raw: { command: 'bun' },
  };
  expect(mapMcpEntryToDto(entry, undefined)).toEqual({
    name: 'read_file',
    kind: McpTransportKind.Stdio,
    authKind: McpAuthKind.Static,
    status: McpServerStatus.Skipped,
    reason: 'not mounted this session — use Test Mount',
  });
});

test('mapMcpEntryToDto: reflects a recorded mount-status snapshot + OAuth authKind', () => {
  const entry: HttpServerEntry = {
    kind: EngineKind.Http,
    name: 'gh',
    url: 'https://x.test',
    headers: {},
    auth: { kind: EngineAuthKind.OAuth as const },
    raw: { type: 'http', url: 'https://x.test' },
  };
  expect(mapMcpEntryToDto(entry, { status: 'mounted' })).toEqual({
    name: 'gh',
    kind: McpTransportKind.Http,
    authKind: McpAuthKind.OAuth,
    status: McpServerStatus.Mounted,
  });
});

test('mapMcpEntryToDto: carries the agents scope when present', () => {
  const entry: StdioServerEntry = {
    kind: EngineKind.Stdio,
    name: 'scoped',
    command: 'bun',
    args: [],
    env: {},
    agents: ['file_qa'],
    raw: { command: 'bun' },
  };
  expect(mapMcpEntryToDto(entry, undefined).agents).toEqual(['file_qa']);
});

test('mapMcpDormantToDto: surfaces the missing-vars reason with the retained kind', () => {
  expect(
    mapMcpDormantToDto({
      name: 'gh',
      kind: EngineKind.Http,
      missingVars: ['GH_TOKEN'],
    }),
  ).toEqual({
    name: 'gh',
    kind: McpTransportKind.Http,
    authKind: McpAuthKind.Static,
    status: McpServerStatus.Dormant,
    reason: 'set GH_TOKEN to activate',
  });
});
