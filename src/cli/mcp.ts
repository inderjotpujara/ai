import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { defaultConfigPath, loadMcpConfig } from '../mcp/config.ts';
import { getPackEntry, STARTER_PACK } from '../mcp/pack.ts';

/** Copy a starter-pack entry into mcp.json (atomic write; never overwrites). */
export function addPackEntry(
  name: string,
  configPath: string = defaultConfigPath(),
): { ok: boolean; message: string } {
  const pack = getPackEntry(name);
  if (!pack) {
    return {
      ok: false,
      message: `unknown pack entry "${name}" — run \`bun run mcp list\``,
    };
  }
  let root: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(configPath)) {
    try {
      root = JSON.parse(readFileSync(configPath, 'utf8')) as typeof root;
    } catch (cause) {
      return {
        ok: false,
        message: `mcp.json is not valid JSON: ${(cause as Error).message}`,
      };
    }
  }
  const servers = root.mcpServers ?? {};
  if (servers[name]) {
    return {
      ok: false,
      message: `"${name}" already exists in ${configPath} — edit it directly`,
    };
  }
  servers[name] = pack.server;
  const tmp = `${configPath}.tmp`;
  writeFileSync(
    tmp,
    `${JSON.stringify({ ...root, mcpServers: servers }, null, 2)}\n`,
  );
  renameSync(tmp, configPath);
  const keyNote = pack.requiresEnv?.length
    ? ` (dormant until ${pack.requiresEnv.join(', ')} is set)`
    : '';
  return { ok: true, message: `added "${name}" to ${configPath}${keyNote}` };
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

function main(): void {
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
    const r = addPackEntry(arg);
    (r.ok ? console.log : console.error)(r.message);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  console.error('Usage: bun run mcp <list|status|add <name>>');
  process.exitCode = 1;
}

if (import.meta.main) main();
