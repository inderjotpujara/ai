import type { McpMountStatusEntry } from '../../mcp/mcp-dto.ts';

export type McpMountStatus = {
  record(name: string, status: 'mounted' | 'skipped', reason?: string): void;
  get(name: string): McpMountStatusEntry | undefined;
};

/**
 * Addressable, in-memory mount-attempt snapshot, keyed by server name — today
 * `mountAll`'s `mounted`/`skipped` result (`src/mcp/mount.ts`) is per-run-only,
 * never persisted or queryable outside the process that mounted it (spec
 * §4.2 item 6). Refreshed on every `POST /api/mcp/test-mount` attempt; one
 * instance lives on `ServerDeps` for the process lifetime — analogous to the
 * Phase-3 mtime summary cache, but keyed by name, not mtime.
 */
export function createMcpMountStatus(): McpMountStatus {
  const snapshot = new Map<string, McpMountStatusEntry>();
  return {
    record(name, status, reason) {
      snapshot.set(
        name,
        reason !== undefined ? { status, reason } : { status },
      );
    },
    get(name) {
      return snapshot.get(name);
    },
  };
}
