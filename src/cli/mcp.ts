import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { defaultConfigPath, loadMcpConfig } from '../mcp/config.ts';
import { getPackEntry, STARTER_PACK } from '../mcp/pack.ts';
import type { PackEntry } from '../mcp/types.ts';

type PackWriteResult = { ok: boolean; message: string };
type PackRoot = { mcpServers?: Record<string, unknown> };

/** Per-config-path queue: serializes each file's read-modify-write critical
 *  section so two concurrent `addPackEntry` calls can't interleave a stale
 *  read with another's write (Slice-15 check-then-act finding). Settled
 *  (never-rejecting) so one failed add can't wedge the queue for the path. */
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

/** Load mcp.json, defaulting to an empty root when it doesn't exist yet. */
async function readRoot(
  configPath: string,
): Promise<{ ok: true; root: PackRoot } | { ok: false; message: string }> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, root: {} };
    }
    return {
      ok: false,
      message: `cannot read mcp.json: ${(cause as Error).message}`,
    };
  }
  try {
    return { ok: true, root: JSON.parse(raw) as PackRoot };
  } catch (cause) {
    return {
      ok: false,
      message: `mcp.json is not valid JSON: ${(cause as Error).message}`,
    };
  }
}

/** Read-modify-write critical section: always re-reads the file fresh (never
 *  a snapshot captured before the caller's turn in the queue), so it only
 *  ever sees the latest on-disk state — no lost updates, no duplicates.
 *  Crash-atomic write via a per-call temp file + rename. */
async function writePackEntry(
  name: string,
  pack: PackEntry,
  configPath: string,
): Promise<PackWriteResult> {
  const loaded = await readRoot(configPath);
  if (!loaded.ok) return loaded;
  const { root } = loaded;
  const servers = root.mcpServers ?? {};
  if (servers[name]) {
    return {
      ok: false,
      message: `"${name}" already exists in ${configPath} — edit it directly`,
    };
  }
  servers[name] = pack.server;
  const tmp = `${configPath}.tmp-${randomUUID()}`;
  await writeFile(
    tmp,
    `${JSON.stringify({ ...root, mcpServers: servers }, null, 2)}\n`,
  );
  await rename(tmp, configPath);
  const keyNote = pack.requiresEnv?.length
    ? ` (dormant until ${pack.requiresEnv.join(', ')} is set)`
    : '';
  return { ok: true, message: `added "${name}" to ${configPath}${keyNote}` };
}

/** Copy a starter-pack entry into mcp.json (atomic write; never overwrites).
 *  Concurrent calls for the same configPath are serialized (see
 *  `withFileLock`) so no update is lost and no entry is duplicated. */
export function addPackEntry(
  name: string,
  configPath: string = defaultConfigPath(),
): Promise<PackWriteResult> {
  const pack = getPackEntry(name);
  if (!pack) {
    return Promise.resolve({
      ok: false,
      message: `unknown pack entry "${name}" — run \`bun run mcp list\``,
    });
  }
  return withFileLock(configPath, () => writePackEntry(name, pack, configPath));
}

function list(): void {
  const cfg = loadMcpConfig();
  const inConfig = new Set([
    ...cfg.entries.map((e) => e.name),
    ...cfg.dormant.map((d) => d.name),
  ]);
  console.log('Starter pack (bun run mcp add <name>):\n');
  for (const e of STARTER_PACK) {
    const state = inConfig.has(e.name) ? '✓ in mcp.json' : ' ';
    const key = e.requiresEnv?.length ? ` 🔑 ${e.requiresEnv.join(',')}` : '';
    console.log(
      `  [${state}] ${e.name}  (${e.capabilities.join(', ')})${key}\n        ${e.description}`,
    );
  }
}

function status(): void {
  const cfg = loadMcpConfig();
  for (const w of cfg.warnings) console.error(`⚠ ${w}`);
  console.log(`Configured servers (${defaultConfigPath()}):\n`);
  for (const e of cfg.entries) {
    const scope = e.agents ? `agents: ${e.agents.join(', ')}` : 'agents: all';
    console.log(`  active   ${e.name}  (${e.kind}; ${scope})`);
  }
  for (const d of cfg.dormant) {
    console.log(`  dormant  ${d.name}  (set ${d.missingVars.join(', ')})`);
  }
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'list') {
    list();
    return;
  }
  if (cmd === 'status') {
    status();
    return;
  }
  if (cmd === 'add' && arg) {
    const r = await addPackEntry(arg);
    (r.ok ? console.log : console.error)(r.message);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  console.error('Usage: bun run mcp <list|status|add <name>>');
  process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
