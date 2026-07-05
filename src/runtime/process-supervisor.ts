import { withWallClock } from '../reliability/timeout.ts';

export type ChildHandle = {
  pid: number;
  kill(sig?: NodeJS.Signals): void;
  onExit(cb: (code: number | null) => void): void;
};

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts?: { env?: Record<string, string> },
) => ChildHandle;

export type SupervisedServer = { baseUrl: string; stop(): Promise<void> };

export type SuperviseDeps = {
  spawn?: SpawnFn;
  fetchImpl?: typeof fetch;
  startTimeoutMs?: number;
  pollMs?: number;
};

export type SuperviseCfg = {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  host: string;
  port: number;
  basePath: string; // e.g. '/v1'
  healthPath: string; // '/health' | '/v1/models'
  healthOk?: (res: Response) => boolean; // default: res.ok
};

const defaultSpawn: SpawnFn = (cmd, args, opts) => {
  const proc = Bun.spawn([cmd, ...args], {
    env: { ...process.env, ...opts?.env },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return {
    pid: proc.pid,
    kill: (sig) => proc.kill(sig as never),
    onExit: (cb) => {
      proc.exited.then((code) => cb(code));
    },
  };
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Spawns a local server process, polls its health endpoint until ready, and reports a baseUrl. */
export async function superviseServer(
  cfg: SuperviseCfg,
  deps: SuperviseDeps = {},
): Promise<SupervisedServer> {
  const spawn = deps.spawn ?? defaultSpawn;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const startTimeoutMs = deps.startTimeoutMs ?? 30000;
  const pollMs = deps.pollMs ?? 250;
  const healthOk = cfg.healthOk ?? ((res: Response) => res.ok);

  const child = spawn(cfg.cmd, cfg.args, { env: cfg.env });
  const baseUrl = `http://${cfg.host}:${cfg.port}${cfg.basePath}`;
  const healthUrl = `http://${cfg.host}:${cfg.port}${cfg.healthPath}`;

  const stop = async (): Promise<void> => {
    child.kill('SIGTERM');
  };

  let timedOut = false;
  try {
    await withWallClock(startTimeoutMs, async () => {
      while (!timedOut) {
        try {
          const res = await fetchImpl(healthUrl, {
            signal: AbortSignal.timeout(pollMs + 1000),
          });
          if (healthOk(res)) return;
        } catch {
          // health check failed or timed out; keep polling until wall-clock timeout
        }
        await sleep(pollMs);
      }
    });
  } catch {
    timedOut = true;
    child.kill('SIGTERM');
    throw new Error(
      `runtime failed to become healthy after ${startTimeoutMs}ms`,
    );
  }

  return { baseUrl, stop };
}
