/**
 * `agent triggers <subcommand>` — the terminal surface for managing triggers
 * (Slice 25, Task 32), mirroring `src/cli/daemon.ts`'s shape exactly:
 * `runTriggersCli` is pure dispatch over an injected `TriggersCliDeps` seam
 * (no direct fs/DB/process in the dispatcher body — testable), a
 * `buildRealTriggersDeps()` wires the real store/secret-store/fire over the
 * SAME `jobs.db` the daemon uses, and the `if (import.meta.main)` entry
 * strips a leading `'triggers'` token so both `agent triggers <sub>` and
 * `bun src/cli/triggers.ts <sub>` dispatch identically.
 *
 * LIVE DB, NO RESTART: a console-origin row created/edited here is a plain
 * row in the SAME SQLite triggers table the running daemon's scheduler reads
 * on every poll tick — the daemon picks it up on its next tick, no restart
 * required (only repo-origin triggers need a resync).
 *
 * WEBHOOK SECRETS (§7.1): `add` for a webhook trigger server-mints the path
 * token (+ HMAC secret when `config.hmac`) exactly like
 * `server/triggers/create.ts` — never client-supplied — and the dispatcher
 * prints it ONCE with a "shown once" note. No secret is ever logged beyond
 * that single print.
 */

import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config/schema.ts';
import type { TriggerTypeWire } from '../contracts/index.ts';
import { createJobStore } from '../queue/store.ts';
import { parseTriggerConfig } from '../server/triggers/config-parse.ts';
import { createFireTrigger } from '../triggers/fire.ts';
import { computeNextRun } from '../triggers/next-run.ts';
import { createTriggerSecretStore } from '../triggers/secret-store.ts';
import { createTriggerStore } from '../triggers/store.ts';
import {
  type Trigger,
  type TriggerFiring,
  type TriggerInput,
  TriggerOrigin,
  TriggerType,
  type WebhookConfig,
} from '../triggers/types.ts';
import { hashToken } from '../triggers/webhook-verify.ts';

export type TriggersCliDeps = {
  list(): Trigger[];
  add(spec: TriggerInput): { trigger: Trigger; token?: string; url?: string };
  /**
   * Fix 2 (Task 32 review): the same M2 duplicate-name pre-check the HTTP
   * create route runs (`store.getByName(name, TriggerOrigin.Console)`) —
   * lets `add` print a clean "already exists" error and exit non-zero
   * BEFORE any mint/insert, instead of the raw SQLITE_CONSTRAINT surfacing
   * from a top-level catch.
   */
  getByName(name: string): Trigger | undefined;
  setEnabled(id: string, enabled: boolean): void;
  remove(id: string): void;
  history(id: string): TriggerFiring[];
  fire(
    id: string,
  ): Promise<{ jobId: string; runId: string } | { skipped: string }>;
  print: (s: string) => void;
};

function formatTriggerTable(triggers: Trigger[]): string {
  const header = ['id', 'name', 'type', 'enabled', 'nextRunAt'];
  const rows = triggers.map((t) => [
    t.id,
    t.name,
    t.type,
    String(t.enabled),
    t.nextRunAt ? new Date(t.nextRunAt).toISOString() : '-',
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((c) => c.padEnd(20)).join(' '))
    .join('\n');
}

function formatFiringTable(firings: TriggerFiring[]): string {
  const header = ['firedAt', 'outcome', 'jobId', 'runId'];
  const rows = firings.map((f) => [
    new Date(f.firedAt).toISOString(),
    f.outcome,
    f.jobId ?? '-',
    f.runId ?? '-',
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((c) => c.padEnd(24)).join(' '))
    .join('\n');
}

export async function runTriggersCli(
  argv: string[],
  deps: TriggersCliDeps,
): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'list') {
    const triggers = deps.list();
    deps.print(
      triggers.length === 0 ? 'no triggers' : formatTriggerTable(triggers),
    );
    return;
  }
  if (cmd === 'add') {
    const raw = argv[1];
    if (!raw) {
      deps.print("usage: agent triggers add '<json>'");
      return;
    }
    let spec: TriggerInput;
    try {
      spec = JSON.parse(raw) as TriggerInput;
    } catch (err) {
      deps.print(
        `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    // Fix 1 (Task 32 review): run the SAME `parseTriggerConfig` the HTTP
    // create route runs — per-type Zod schema + `validateCron` (rejects an
    // unparseable cron pattern) + `confineWatchPath` (file-trigger path
    // confinement) — BEFORE any mint/insert. Without this, a bad cron
    // pattern silently created a dead trigger (computeNextRun → null →
    // nextRunAt undefined) while still printing "created". `spec.type` is
    // the domain `TriggerType`; it's isomorphic with the wire
    // `TriggerTypeWire` (guarded by trigger-enum-parity.test.ts), same cast
    // idiom used throughout this file and config-parse.ts.
    let config: ReturnType<typeof parseTriggerConfig>;
    try {
      config = parseTriggerConfig(
        spec.type as unknown as TriggerTypeWire,
        spec.config,
      );
    } catch (err) {
      deps.print(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    // Fix 2 (Task 32 review): the same M2 duplicate-name pre-check the HTTP
    // route runs — a clean error BEFORE any mint/insert, rather than letting
    // the store's `UNIQUE(name, origin)` constraint surface as a raw
    // SQLITE_CONSTRAINT from the top-level catch.
    if (deps.getByName(spec.name)) {
      deps.print(
        `error: a console trigger named "${spec.name}" already exists`,
      );
      process.exitCode = 1;
      return;
    }
    const { trigger, token, url } = deps.add({ ...spec, config });
    deps.print(`created ${trigger.id} (${trigger.name})`);
    if (token) {
      deps.print(`webhook token (shown once — save it now): ${token}`);
    }
    if (url) {
      deps.print(`webhook url: ${url}`);
    }
    return;
  }
  if (cmd === 'enable' || cmd === 'disable') {
    const id = argv[1];
    if (!id) {
      deps.print(`usage: agent triggers ${cmd} <id>`);
      return;
    }
    deps.setEnabled(id, cmd === 'enable');
    deps.print(`${cmd}d ${id}`);
    return;
  }
  if (cmd === 'remove') {
    const id = argv[1];
    if (!id) {
      deps.print('usage: agent triggers remove <id>');
      return;
    }
    deps.remove(id);
    deps.print(`removed ${id}`);
    return;
  }
  if (cmd === 'history') {
    const id = argv[1];
    if (!id) {
      deps.print('usage: agent triggers history <id>');
      return;
    }
    const firings = deps.history(id);
    deps.print(
      firings.length === 0 ? 'no firings' : formatFiringTable(firings),
    );
    return;
  }
  if (cmd === 'fire') {
    const id = argv[1];
    if (!id) {
      deps.print('usage: agent triggers fire <id>');
      return;
    }
    const result = await deps.fire(id);
    if ('skipped' in result) {
      deps.print(`not fired: ${result.skipped}`);
      return;
    }
    deps.print(`fired: jobId=${result.jobId} runId=${result.runId}`);
    return;
  }
  deps.print(
    'usage: agent triggers <list|add|enable|disable|remove|history|fire>',
  );
}

/**
 * Wires the real (non-test) deps: the trigger store + secret store + a
 * standalone `createFireTrigger` over the SAME `AGENT_QUEUE_PATH` jobs.db the
 * daemon's engine uses — no scheduler/watcher are started here (this is a
 * one-shot CLI invocation, not the always-on daemon), so `add`/`remove`/etc.
 * just read/write rows the running daemon's scheduler will pick up on its
 * own next tick.
 */
function buildRealTriggersDeps(): TriggersCliDeps {
  const cfg = loadConfig().values;
  const dbPath = String(cfg.AGENT_QUEUE_PATH);
  const runsRoot = process.env.AGENT_RUNS_ROOT ?? 'runs';
  const store = createTriggerStore({ path: dbPath });
  const secretStore = createTriggerSecretStore({});
  const jobStore = createJobStore({ path: dbPath }, {});
  const fireTrigger = createFireTrigger({
    triggerStore: store,
    jobStore,
    runsRoot,
    maxChainDepth: () => cfg.AGENT_TRIGGERS_MAX_CHAIN_DEPTH as number,
  });
  // Mirrors server/main.ts's publicBaseUrl fallback: AGENT_WEB_PUBLIC_URL
  // (e.g. a Tailscale/Cloudflare hostname) else the configured bind:port —
  // fine for a same-box operator running this CLI.
  const publicBaseUrl =
    (cfg.AGENT_WEB_PUBLIC_URL as string) ||
    `http://${cfg.AGENT_WEB_BIND}:${cfg.AGENT_WEB_PORT}`;

  return {
    list: () => store.list(),
    getByName: (name) => store.getByName(name, TriggerOrigin.Console),
    add: (spec) => {
      // Console-origin only (Task 32 scope): never trust an origin field a
      // caller might smuggle in the JSON — mirrors the wire
      // TriggerCreateRequestSchema, which has no origin field at all.
      const input: TriggerInput = { ...spec, origin: TriggerOrigin.Console };
      let webhookToken: string | undefined;
      let webhookUrl: string | undefined;
      let tokenHashValue: string | undefined;
      if (input.type === TriggerType.Webhook) {
        // Server-mint only (§7.1) — same recipe as
        // server/triggers/create.ts: a 128-bit path token, its SHA-256 hash
        // persisted (never the raw token), plus an HMAC secret when
        // config.hmac is set.
        webhookToken = randomBytes(16).toString('hex');
        tokenHashValue = hashToken(webhookToken);
        if ((input.config as WebhookConfig).hmac) {
          const { secretRef } = secretStore.mint();
          input.secretRef = secretRef;
        }
        webhookUrl = `${publicBaseUrl}/hooks/${webhookToken}`;
      }
      if (input.type === TriggerType.Cron) {
        input.nextRunAt =
          computeNextRun({ config: input.config } as Trigger, Date.now()) ??
          undefined;
      }
      let trigger: Trigger;
      try {
        trigger = store.create(
          input,
          tokenHashValue ? { tokenHash: tokenHashValue } : undefined,
        );
      } catch (err) {
        // A minted secret with no row to reference it is an orphan on disk —
        // clean it up before rethrowing (mirrors create.ts).
        if (input.secretRef) secretStore.remove(input.secretRef);
        throw err;
      }
      return { trigger, token: webhookToken, url: webhookUrl };
    },
    setEnabled: (id, enabled) => {
      store.update(id, { enabled });
    },
    remove: (id) => {
      const existing = store.get(id);
      if (existing?.secretRef) secretStore.remove(existing.secretRef);
      store.remove(id);
    },
    history: (id) => store.listFirings(id, { limit: 50 }).items,
    fire: async (id) => {
      const trigger = store.get(id);
      if (!trigger) return { skipped: 'not found' };
      // Manual test-fire: fresh chain (no chainDepth from any external
      // input) + bypassOverlap, mirroring server/triggers/fire.ts exactly.
      const result = await fireTrigger(trigger, {
        reason: 'manual',
        bypassOverlap: true,
      });
      if (!result.fired) return { skipped: result.outcome };
      return { jobId: result.jobId, runId: result.runId };
    },
    print: (s) => {
      console.log(s);
    },
  };
}

if (import.meta.main) {
  // Strip a leading 'triggers' token so a future unified `agent <group>
  // <subcommand>` CLI (forwarding argv as `agent triggers <sub>`, the same
  // idiom daemon.ts documents) and a direct `bun src/cli/triggers.ts <sub>`
  // invocation dispatch identically.
  const argv = process.argv.slice(2);
  const args = argv[0] === 'triggers' ? argv.slice(1) : argv;
  runTriggersCli(args, buildRealTriggersDeps()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
