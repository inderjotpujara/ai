import {
  McpAuthKind as ContractAuthKind,
  type McpTransportKind as ContractTransportKind,
  type McpServerDTO,
  McpServerStatus,
} from '../contracts/index.ts';
import {
  McpAuthKind,
  type McpConfig,
  type McpServerEntry,
  McpTransportKind,
} from './types.ts';

/** What the addressable mount-status snapshot (`src/server/mcp/mount-status.ts`)
 *  records for one server name after a mount attempt — today only
 *  `POST /api/mcp/test-mount` (Task 23) ever calls `.record(...)`: a real
 *  agent/crew/workflow run mounts under its OWN per-run `MountedRegistry`
 *  (`withMcpRun`) and never touches this snapshot. Deliberately a plain
 *  `'mounted' | 'skipped'` literal union rather than the wire `McpMountStatus`
 *  enum: this is the narrower, un-addressable per-attempt outcome, and
 *  keeping it a literal keeps `.record(name, status)` call sites taking bare
 *  string literals (see `src/server/mcp/mount-status.ts`). */
export type McpMountStatusEntry = {
  status: 'mounted' | 'skipped';
  reason?: string;
};

const NEVER_MOUNTED_REASON = 'not mounted this session — use Test Mount';

/**
 * Projects one validated `McpServerEntry` (`src/mcp/types.ts`) to the wire
 * `McpServerDTO`, joined with its mount-status snapshot record (or the
 * "never attempted" default). Engine enum comparisons (`entry.kind ===
 * McpTransportKind.Http`) use the ENGINE enum so TS narrows `entry` to
 * `HttpServerEntry` and its `.auth` field is reachable; the OUTPUT dto
 * fields use the CONTRACT enum (parity-tested equal values, Increment 1) —
 * contracts stay isomorphic (never import `src/mcp`), so the two enums are
 * deliberately kept as separate imports, not one shared identifier.
 */
export function mapMcpEntryToDto(
  entry: McpServerEntry,
  mounted: McpMountStatusEntry | undefined,
): McpServerDTO {
  const authKind =
    entry.kind === McpTransportKind.Http &&
    entry.auth?.kind === McpAuthKind.OAuth
      ? ContractAuthKind.OAuth
      : ContractAuthKind.Static;
  const status: McpServerStatus = mounted
    ? mounted.status === 'mounted'
      ? McpServerStatus.Mounted
      : McpServerStatus.Skipped
    : McpServerStatus.Skipped;
  return {
    name: entry.name,
    kind: entry.kind as unknown as ContractTransportKind,
    ...(entry.agents ? { agents: entry.agents } : {}),
    authKind,
    status,
    ...(mounted
      ? mounted.reason !== undefined
        ? { reason: mounted.reason }
        : {}
      : { reason: NEVER_MOUNTED_REASON }),
  };
}

/** A dormant entry never reached `ensureConsent`/`mount` (env vars unset), so
 *  it's always `authKind: Static` here — an OAuth dormant entry would need
 *  its raw `auth` field, which `McpConfig.dormant` doesn't retain (only
 *  `kind`, Task 19); this is a documented, harmless simplification since a
 *  dormant row's Test-Mount action is disabled in the web UI anyway. */
export function mapMcpDormantToDto(
  d: McpConfig['dormant'][number],
): McpServerDTO {
  return {
    name: d.name,
    kind: d.kind as unknown as ContractTransportKind,
    authKind: ContractAuthKind.Static,
    status: McpServerStatus.Dormant,
    reason: `set ${d.missingVars.join(', ')} to activate`,
  };
}
