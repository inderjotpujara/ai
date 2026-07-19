/**
 * `agent daemon <subcommand>` — the macOS launchd-backed lifecycle CLI
 * (Slice 24 Increment 4, Task 29): install/start/stop/status/logs over
 * `launchctl`, plus the `start-foreground` subcommand launchd's
 * `ProgramArguments` (Task 28's plist) actually runs.
 *
 * `runDaemonCli` is pure dispatch over an injected `DaemonCliDeps` seam — no
 * subcommand shells out to `launchctl`/`tail` or touches the filesystem
 * directly, so tests can assert exactly which invocation each subcommand
 * builds without ever loading a real launchd agent. `install` is macOS-only;
 * on any other platform it prints the documented systemd-unit guidance
 * instead of failing, per the brief (systemd support itself is a later slice).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCrew } from '../../crews/index.ts';
import { getWorkflow } from '../../workflows/index.ts';
import { loadConfig } from '../config/schema.ts';
import { RuntimeKind } from '../core/types.ts';
import { createDaemon } from '../daemon/core.ts';
import {
  defaultLaunchdLabel,
  launchdPlistPath,
  renderLaunchdPlist,
} from '../daemon/launchd.ts';
import { defaultPidPath, readLivePid } from '../daemon/pid.ts';
import { makeEmbedder, probeEmbedder } from '../memory/embed.ts';
import { makeCrossEncoderReranker } from '../memory/reranker.ts';
import { createMemoryStore } from '../memory/store.ts';
import { computeConcurrency } from '../queue/concurrency.ts';
import { createWorkerPool } from '../queue/pool.ts';
import { createJobStore } from '../queue/store.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { runtimeFor } from '../runtime/registry.ts';
import {
  createLazyEngine,
  createRealRunChatTurn,
} from '../server/chat/run-turn.ts';
import { createJobDispatch } from '../server/jobs/dispatch.ts';
import {
  createRealRunBuilderTurn,
  createRealRunCrewTurn,
  createRealRunModelPull,
  createRealRunWorkflowTurn,
} from '../server/launch-turns.ts';
import { startWebServer } from '../server/main.ts';

export type DaemonCliDeps = {
  run: (cmd: string, args: string[]) => void;
  writeFile: (path: string, body: string) => void;
  plistPath: string;
  renderPlist: () => string;
  status: () => { running: boolean; pid?: number };
  stopDaemon: () => Promise<void>;
  startForeground: () => Promise<void>;
  logPaths: string[];
  platform: NodeJS.Platform;
  print: (s: string) => void;
};

export async function runDaemonCli(
  argv: string[],
  deps: DaemonCliDeps,
): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'install') {
    if (deps.platform !== 'darwin') {
      deps.print(
        'launchd install is macOS-only. On Linux, create a systemd --user ' +
          'unit invoking `bun run src/cli/daemon.ts start-foreground` (see docs).',
      );
      return;
    }
    deps.writeFile(deps.plistPath, deps.renderPlist());
    deps.run('launchctl', ['load', deps.plistPath]);
    deps.print(`installed ${deps.plistPath}`);
    return;
  }
  if (cmd === 'start') {
    deps.run('launchctl', ['load', deps.plistPath]);
    return;
  }
  if (cmd === 'start-foreground') {
    await deps.startForeground(); // the launchd ProgramArguments target
    return;
  }
  if (cmd === 'stop') {
    deps.run('launchctl', ['unload', deps.plistPath]);
    await deps.stopDaemon();
    return;
  }
  if (cmd === 'status') {
    const s = deps.status();
    deps.print(s.running ? `running (pid ${s.pid})` : 'not running');
    return;
  }
  if (cmd === 'logs') {
    deps.run('tail', ['-f', ...deps.logPaths]);
    return;
  }
  deps.print('usage: agent daemon <install|start|stop|status|logs>');
}

/**
 * Constructs the daemon's queue (store + dispatch + pool) exactly as
 * `src/server/main.ts`'s own standalone boot does, then hands it to
 * `createDaemon` so `start()` can run the §7.3 reconcile-before-claim
 * ordering BEFORE injecting this same pool into `startWebServer` — the one
 * real `startForeground` needs; every other subcommand only touches the pid
 * file or shells out, so it stays cheap.
 */
function buildRealDaemon() {
  const cfg = loadConfig().values;
  const runsRoot = 'runs';
  const runCrewTurn = createRealRunCrewTurn(runsRoot);
  const runWorkflowTurn = createRealRunWorkflowTurn(runsRoot);
  const runBuilderTurn = createRealRunBuilderTurn(runsRoot);
  const runModelPull = createRealRunModelPull(runsRoot);
  const memoryEmbedModel =
    process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
  const memoryManager = createModelManager();
  const memoryEmbedder = makeEmbedder({
    ensureReady: (decl) => memoryManager.ensureReady(decl),
    control: runtimeFor(RuntimeKind.Ollama).control,
    model: memoryEmbedModel,
  });
  const memoryStore = createMemoryStore(
    { embedModel: memoryEmbedModel },
    {
      embedTexts: memoryEmbedder.embed,
      embedQuery: async (text) =>
        (await memoryEmbedder.embed([text]))[0] as number[],
      probe: probeEmbedder,
      reranker: makeCrossEncoderReranker(),
    },
  );
  const runChatTurn = createRealRunChatTurn(
    createLazyEngine(runsRoot),
    memoryStore,
  );
  const jobStore = createJobStore({ path: String(cfg.AGENT_QUEUE_PATH) }, {});
  const dispatch = createJobDispatch({
    runCrewTurn,
    getCrew,
    runWorkflowTurn,
    getWorkflow,
    runModelPull,
    runChatTurn,
    runBuilderTurn,
    runsRoot,
  });
  const pool = createWorkerPool({
    store: jobStore,
    concurrency: computeConcurrency(),
    dispatch,
    pollMs: cfg.AGENT_QUEUE_POLL_MS as number,
  });
  return createDaemon({ startWebServer, queue: jobStore, pool });
}

function defaultLogDir(): string {
  return join(defaultPidPath(), '..', 'logs');
}

/** Builds the real (non-test) deps: launchctl/tail via `execFileSync`, the
 *  plist via Task 28's renderer, and the daemon's own pid file for `status`/
 *  `stop` — reading the pid directly is enough for both (no need to boot the
 *  full queue+pool just to answer "is it running").  */
function buildRealDeps(): DaemonCliDeps {
  const label = defaultLaunchdLabel();
  const plistPath = launchdPlistPath(label);
  const logDir = defaultLogDir();
  const entryScript = fileURLToPath(import.meta.url);
  const bunPath = Bun.which('bun') ?? process.execPath;
  return {
    run: (cmd, args) => {
      execFileSync(cmd, args, { stdio: 'inherit' });
    },
    writeFile: (path, body) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    },
    plistPath,
    renderPlist: () =>
      renderLaunchdPlist({
        label,
        bunPath,
        entryScript,
        logDir,
        workingDir: process.cwd(),
      }),
    status: () => {
      const pid = readLivePid(defaultPidPath());
      return { running: pid !== undefined, pid };
    },
    stopDaemon: async () => {
      const pid = readLivePid(defaultPidPath());
      // Signal the running daemon directly (belt-and-suspenders alongside
      // `launchctl unload`): the daemon's own SIGTERM handler (installed in
      // `createDaemon().start()`) drains gracefully via `stop()`, and this
      // path also covers a daemon started via `start-foreground` directly
      // (never launchd-installed, so `launchctl unload` has nothing to do).
      if (pid !== undefined) process.kill(pid, 'SIGTERM');
    },
    startForeground: async () => {
      await buildRealDaemon().start();
      // launchd (and a direct `start-foreground` invocation) keeps this
      // process alive in the foreground; `createDaemon().start()` already
      // installed the SIGINT/SIGTERM handlers that drain via `stop()`, so
      // there's nothing left to do here but stay up.
      await new Promise<void>(() => {});
    },
    logPaths: [join(logDir, 'agent.out.log'), join(logDir, 'agent.err.log')],
    platform: process.platform,
    print: (s) => {
      console.log(s);
    },
  };
}

if (import.meta.main) {
  // A future unified `agent <group> <subcommand>` CLI would invoke this
  // module as `agent daemon <subcommand>`, forwarding argv with a leading
  // 'daemon' token (also how launchd's own ProgramArguments — Task 28 —
  // names it: `[bun, entryScript, 'daemon', 'start-foreground']`); strip it
  // when present so both that form and a direct `bun src/cli/daemon.ts
  // <subcommand>` invocation dispatch identically.
  const argv = process.argv.slice(2);
  const args = argv[0] === 'daemon' ? argv.slice(1) : argv;
  runDaemonCli(args, buildRealDeps()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
