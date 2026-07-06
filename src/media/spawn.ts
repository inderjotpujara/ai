import type { SpawnFn } from '../runtime/process-supervisor.ts';

/** Shared `Bun.spawn` → `ChildHandle` adapter used by every media subprocess
 *  site (transcribe, frame sampling, one-shot generation). Merges `opts.env`
 *  over the current environment so callers that need custom env (e.g. the
 *  generation adapter) get it, while callers that don't (transcribe, frames)
 *  can simply omit it. */
export const defaultSpawn: SpawnFn = (cmd, args, opts) => {
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
