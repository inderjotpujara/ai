import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

type WriteResult = { ok: boolean; message: string };
type ConfigRoot = { mcpServers?: Record<string, unknown> };

/** Per-config-path queue — mirrors `src/cli/mcp.ts`'s `withFileLock`: two
 *  concurrent adds against the SAME config file must not interleave a stale
 *  read with another's write. Settled (never-rejecting) so one failed add
 *  can't wedge the queue for the path. A fresh, file-scoped instance here
 *  (not imported from `cli/mcp.ts`, which is private/CLI-shaped and keys its
 *  writes by a STARTER_PACK lookup, not a raw server value). */
const fileLocks = new Map<string, Promise<unknown>>();

function withFileLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const tail = fileLocks.get(path) ?? Promise.resolve();
  const next = tail.then(fn, fn);
  fileLocks.set(
    path,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function readRoot(
  configPath: string,
): Promise<{ ok: true; root: ConfigRoot } | { ok: false; message: string }> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
      return { ok: true, root: {} };
    return {
      ok: false,
      message: `cannot read mcp.json: ${(cause as Error).message}`,
    };
  }
  try {
    return { ok: true, root: JSON.parse(raw) as ConfigRoot };
  } catch (cause) {
    return {
      ok: false,
      message: `mcp.json is not valid JSON: ${(cause as Error).message}`,
    };
  }
}

async function doWrite(
  name: string,
  server: Record<string, unknown>,
  configPath: string,
): Promise<WriteResult> {
  const loaded = await readRoot(configPath);
  if (!loaded.ok) return loaded;
  const { root } = loaded;
  const servers = root.mcpServers ?? {};
  if (servers[name]) {
    return { ok: false, message: `"${name}" already exists in ${configPath}` };
  }
  servers[name] = server;
  const tmp = `${configPath}.tmp-${randomUUID()}`;
  await writeFile(
    tmp,
    `${JSON.stringify({ ...root, mcpServers: servers }, null, 2)}\n`,
  );
  await rename(tmp, configPath);
  return { ok: true, message: `added "${name}" to ${configPath}` };
}

/**
 * Writes one raw `mcpServers.<name>` entry into `mcp.json`
 * (`POST /api/mcp/add`, Slice 30b Phase 5) — the same atomic
 * read-modify-write + per-path file-lock discipline as `src/cli/mcp.ts`'s
 * starter-pack `addPackEntry`, generalized to accept the ALREADY-VALIDATED
 * raw server value directly (the web add-server form) rather than looking
 * one up by name in `STARTER_PACK`. Never overwrites an existing key — the
 * caller edits `mcp.json` directly for that (removal/edit is a forward-item).
 */
export function writeMcpEntry(
  name: string,
  server: Record<string, unknown>,
  configPath: string,
): Promise<WriteResult> {
  return withFileLock(configPath, () => doWrite(name, server, configPath));
}
