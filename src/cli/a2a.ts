/**
 * `agent a2a <subcommand>` — the thin OPTIONAL terminal surface over the A2A
 * backend (Slice 31 Increment 7, Task 27). The web Federation tab is the
 * primary UX (`GET/PUT /api/a2a/*` — `server/a2a/config.ts`,`skills.ts`,
 * `token.ts`, `remotes.ts`); this CLI mirrors `runDaemonCli`'s shape exactly
 * (`src/cli/daemon.ts`): `runA2aCli` is pure dispatch over an injected
 * `A2aCliDeps` seam — no subcommand touches a store/client/fs directly, so
 * dispatch is testable without a server — and `buildRealA2aDeps()` wires the
 * real allowlist/enrollment/remote-store/client/card over the configured
 * paths + root token.
 *
 * Subcommands:
 *   skills [list|add '<json>'|remove <id>]   — expose-side allowlist (§7.4)
 *   token [issue <label>|revoke <id>|list]   — expose-side A2A Bearers (§7.2);
 *     `issue` prints the raw secret EXACTLY ONCE — never persisted or
 *     re-printed by this CLI (`list` only ever returns `{id,label,createdAt}`)
 *   remotes [list|add <cardUrl> <token> [skillId]|remove <name>] — consume-side
 *     peers (§7.3); `add` discovers+pins the card BEFORE persisting and resolves
 *     the delegation-target skill (fail-closed on an ambiguous/absent skill)
 *   call <name> '<task>'                     — message/send→poll-to-terminal
 *     to a mounted remote, reusing `delegateAndPoll` (`a2a/mount.ts`) so this
 *     CLI's `call` and the orchestrator's `delegate_to_<name>` tool share the
 *     exact same send/poll/timeout semantics
 *   card                                     — print this node's own Agent
 *     Card (the same shape `GET /.well-known/agent-card.json` serves)
 *
 * No `console.log` in the dispatch body — every subcommand prints exclusively
 * through `deps.print`, matching the daemon/triggers CLIs.
 */

import type { SkillEntry } from '../a2a/allowlist.ts';
import { createA2aAllowlist } from '../a2a/allowlist.ts';
import { buildAgentCard } from '../a2a/card.ts';
import type { RemoteAgent } from '../a2a/client.ts';
import {
  cardUrlHostMismatch,
  createA2aClient,
  resolveSkillId,
} from '../a2a/client.ts';
import type { IssuedToken } from '../a2a/enroll.ts';
import { createA2aEnrollment } from '../a2a/enroll.ts';
import { delegateAndPoll } from '../a2a/mount.ts';
import { createRemoteStore } from '../a2a/remotes.ts';
import { loadConfig } from '../config/schema.ts';
import { createRootTokenStore } from '../server/security/root-token.ts';

export type A2aCliDeps = {
  skills: {
    list(): SkillEntry[];
    put(e: SkillEntry): void;
    remove(id: string): void;
  };
  token: {
    issue(label: string): { id: string; token: string };
    revoke(id: string): void;
    list(): IssuedToken[];
  };
  remotes: {
    list(): RemoteAgent[];
    /** `skillId` is the optional operator-chosen delegation target (Task
     *  30-FIX); when omitted the add auto-picks a sole-skill card and errors on
     *  an ambiguous/absent one, listing the available ids. */
    add(cardUrl: string, token: string, skillId?: string): Promise<RemoteAgent>;
    remove(name: string): void;
  };
  /** `message/send` → poll-to-terminal to a mounted remote (Task 20/21's
   *  `delegateAndPoll`); throws on any remote failure/timeout. */
  call(name: string, task: string): Promise<unknown>;
  /** This node's own advertised Agent Card. */
  card(): unknown;
  print: (s: string) => void;
};

function table(rows: string[][]): string {
  return rows.map((cols) => cols.map((c) => c.padEnd(24)).join(' ')).join('\n');
}

function formatSkillsTable(skills: SkillEntry[]): string {
  const header = ['skillId', 'name', 'kind', 'ref'];
  const rows = skills.map((s) => [s.skillId, s.name, s.kind, s.ref]);
  return table([header, ...rows]);
}

function formatTokensTable(tokens: IssuedToken[]): string {
  const header = ['id', 'label', 'createdAt'];
  const rows = tokens.map((t) => [
    t.id,
    t.label,
    new Date(t.createdAt).toISOString(),
  ]);
  return table([header, ...rows]);
}

function formatRemotesTable(remotes: RemoteAgent[]): string {
  const header = ['name', 'skillId', 'baseUrl', 'pinnedCardHash'];
  const rows = remotes.map((r) => [
    r.name,
    r.skillId,
    r.baseUrl,
    r.pinnedCardHash,
  ]);
  return table([header, ...rows]);
}

/** `err instanceof Error ? err.message : String(err)` — the same message
 *  extraction idiom used throughout the other CLIs (`triggers.ts` et al). */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runSkillsCli(argv: string[], deps: A2aCliDeps): Promise<void> {
  const [sub, arg] = argv;
  if (sub === 'list' || sub === undefined) {
    const skills = deps.skills.list();
    deps.print(skills.length === 0 ? 'no skills' : formatSkillsTable(skills));
    return;
  }
  if (sub === 'add') {
    if (!arg) {
      deps.print("usage: agent a2a skills add '<json>'");
      return;
    }
    let entry: SkillEntry;
    try {
      entry = JSON.parse(arg) as SkillEntry;
    } catch (err) {
      deps.print(`invalid JSON: ${errMessage(err)}`);
      return;
    }
    try {
      deps.skills.put(entry);
    } catch (err) {
      deps.print(`error: ${errMessage(err)}`);
      process.exitCode = 1;
      return;
    }
    deps.print(`added ${entry.skillId}`);
    return;
  }
  if (sub === 'remove') {
    if (!arg) {
      deps.print('usage: agent a2a skills remove <id>');
      return;
    }
    deps.skills.remove(arg);
    deps.print(`removed ${arg}`);
    return;
  }
  deps.print('usage: agent a2a skills <list|add|remove>');
}

async function runTokenCli(argv: string[], deps: A2aCliDeps): Promise<void> {
  const [sub, arg] = argv;
  if (sub === 'issue') {
    if (!arg) {
      deps.print('usage: agent a2a token issue <label>');
      return;
    }
    const { id, token } = deps.token.issue(arg);
    deps.print(`issued ${id}`);
    // The ONE place this raw secret is ever surfaced — never persisted or
    // re-printed by this CLI (mirrors the webhook-token / device-pair "shown
    // once" convention, `triggers.ts` / device pairing).
    deps.print(`token (shown once — save it now): ${token}`);
    return;
  }
  if (sub === 'revoke') {
    if (!arg) {
      deps.print('usage: agent a2a token revoke <id>');
      return;
    }
    deps.token.revoke(arg);
    deps.print(`revoked ${arg}`);
    return;
  }
  if (sub === 'list' || sub === undefined) {
    const tokens = deps.token.list();
    deps.print(tokens.length === 0 ? 'no tokens' : formatTokensTable(tokens));
    return;
  }
  deps.print('usage: agent a2a token <issue|revoke|list>');
}

async function runRemotesCli(argv: string[], deps: A2aCliDeps): Promise<void> {
  const [sub, cardUrlOrName, token, skillId] = argv;
  if (sub === 'list' || sub === undefined) {
    const remotes = deps.remotes.list();
    deps.print(
      remotes.length === 0 ? 'no remotes' : formatRemotesTable(remotes),
    );
    return;
  }
  if (sub === 'add') {
    if (!cardUrlOrName || !token) {
      deps.print('usage: agent a2a remotes add <cardUrl> <token> [skillId]');
      return;
    }
    let remote: RemoteAgent;
    try {
      // `skillId` (optional 3rd arg) is passed through; on an ambiguous/absent
      // skill `add` throws with a message listing the available ids (Task
      // 30-FIX), printed below like any other add error.
      remote = await deps.remotes.add(cardUrlOrName, token, skillId);
    } catch (err) {
      deps.print(`error: ${errMessage(err)}`);
      process.exitCode = 1;
      return;
    }
    deps.print(
      `added ${remote.name} (skill ${remote.skillId}, pinned ${remote.pinnedCardHash})`,
    );
    return;
  }
  if (sub === 'remove') {
    if (!cardUrlOrName) {
      deps.print('usage: agent a2a remotes remove <name>');
      return;
    }
    deps.remotes.remove(cardUrlOrName);
    deps.print(`removed ${cardUrlOrName}`);
    return;
  }
  deps.print('usage: agent a2a remotes <list|add|remove>');
}

export async function runA2aCli(
  argv: string[],
  deps: A2aCliDeps,
): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'skills') return runSkillsCli(argv.slice(1), deps);
  if (cmd === 'token') return runTokenCli(argv.slice(1), deps);
  if (cmd === 'remotes') return runRemotesCli(argv.slice(1), deps);
  if (cmd === 'call') {
    const name = argv[1];
    const task = argv[2];
    if (!name || !task) {
      deps.print("usage: agent a2a call <name> '<task>'");
      return;
    }
    try {
      const result = await deps.call(name, task);
      deps.print(
        typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      );
    } catch (err) {
      deps.print(`error: ${errMessage(err)}`);
      process.exitCode = 1;
    }
    return;
  }
  if (cmd === 'card') {
    deps.print(JSON.stringify(deps.card(), null, 2));
    return;
  }
  deps.print('usage: agent a2a <skills|token|remotes|call|card>');
}

/**
 * Builds the real (non-test) deps: the allowlist/enrollment/remote stores
 * over their configured paths, the A2A client for `remotes add`'s
 * discover-then-pin and `call`'s send→poll, and `buildAgentCard` for `card` —
 * exactly the pieces `server/a2a/*.ts` wires for the HTTP surface, just
 * without a running server.
 */
function buildRealA2aDeps(): A2aCliDeps {
  const cfg = loadConfig().values;
  // Allowlist and token registry are DISTINCT files with DISTINCT JSON shapes
  // ({skills:[...]} object vs [...] array) — the CLI reads the SAME two knobs
  // the daemon wires (server/a2a/wire.ts) so a token issued here is found by
  // the daemon; sharing one path fail-closed-crashes boot.
  const allowlist = createA2aAllowlist({
    path: String(cfg.AGENT_A2A_SKILLS_PATH),
  });
  const rootTokens = createRootTokenStore({});
  const enrollment = createA2aEnrollment({
    rootTokens,
    registryPath: String(cfg.AGENT_A2A_TOKENS_PATH),
  });
  const remoteStore = createRemoteStore({});
  const client = createA2aClient();
  // Mirrors server/main.ts's / cli/triggers.ts's publicBaseUrl fallback:
  // AGENT_WEB_PUBLIC_URL (a Tailscale/Cloudflare hostname) else the
  // configured bind:port — fine for a same-box operator running this CLI.
  const publicBaseUrl =
    (cfg.AGENT_WEB_PUBLIC_URL as string) ||
    `http://${cfg.AGENT_WEB_BIND}:${cfg.AGENT_WEB_PORT}`;

  return {
    skills: {
      list: () => allowlist.list(),
      put: (e) => allowlist.put(e),
      remove: (id) => allowlist.remove(id),
    },
    token: {
      issue: (label) => enrollment.issue(label),
      revoke: (id) => enrollment.revoke(id),
      list: () => enrollment.list(),
    },
    remotes: {
      list: () => remoteStore.list(),
      add: async (cardUrl, token, skillId) => {
        // Discover + pin BEFORE persisting (§7.3) — the SAME ordering
        // `handleRemoteAdd` (server/a2a/remotes.ts) uses: a failed/rejected
        // discover never reaches the store.
        const discovered = await client.discover(cardUrl);
        if (!discovered.ok) {
          throw new Error(`discover failed: ${discovered.reason}`);
        }
        // §7.3 SSRF (capstone B4): the advertised `card.url` (delegation
        // endpoint) is peer-controlled — reject it unless it stays on the SAME
        // host the operator pasted as `cardUrl`. Same guard as `handleRemoteAdd`.
        const mismatch = cardUrlHostMismatch(cardUrl, discovered.card.url);
        if (mismatch !== undefined) {
          throw new Error(`discover failed: ${mismatch}`);
        }
        // Task 30-FIX: resolve the delegation-target skill from the card +
        // optional `skillId` (fail-closed) — the SAME rule as `handleRemoteAdd`.
        const resolvedSkillId = resolveSkillId(discovered.card, skillId);
        const remote: RemoteAgent = {
          // No separate `--name` arg on this thin CLI: the discovered card's
          // own `name` is the remote's display/lookup name (the Federation
          // tab's Add form additionally lets an operator choose one; this
          // subset CLI keeps to the card's own identity).
          name: discovered.card.name,
          baseUrl: discovered.card.url,
          cardUrl,
          token,
          pinnedCardHash: discovered.pinnedCardHash,
          skillId: resolvedSkillId,
        };
        remoteStore.add(remote);
        return remote;
      },
      remove: (name) => remoteStore.remove(name),
    },
    call: async (name, task) => {
      const remote = remoteStore.get(name);
      if (!remote) throw new Error(`no remote named "${name}"`);
      return delegateAndPoll(remote, client, task, {
        taskTimeoutMs: Number(cfg.AGENT_A2A_TASK_TIMEOUT_MS),
        pollIntervalMs: Number(cfg.AGENT_A2A_POLL_INTERVAL_MS),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
    },
    card: () => buildAgentCard({ allowlist, publicBaseUrl }),
    print: (s) => {
      console.log(s);
    },
  };
}

if (import.meta.main) {
  // A future unified `agent <group> <subcommand>` CLI would invoke this
  // module as `agent a2a <subcommand>`, forwarding argv with a leading 'a2a'
  // token; strip it when present so both that form and a direct
  // `bun src/cli/a2a.ts <subcommand>` invocation dispatch identically
  // (mirrors `daemon.ts` / `triggers.ts`).
  const argv = process.argv.slice(2);
  const args = argv[0] === 'a2a' ? argv.slice(1) : argv;
  runA2aCli(args, buildRealA2aDeps()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
