/** Process-wide signal-clean shutdown: SIGINT/SIGTERM run every registered
 *  teardown callback, then drain the child registry, before exiting. Without
 *  this, Ctrl-C bypasses every `finally` block and orphans spawned children
 *  (model-server supervision, media generation, voice mic/transcribe). */
import { killAllChildren } from './child-registry.ts';

type OnFn = (sig: string, cb: () => void) => void;
type ExitFn = (code: number) => void;

const callbacks: Array<() => void | Promise<void>> = [];

/** Register a teardown callback to run on SIGINT/SIGTERM before exit. */
export function onShutdown(fn: () => void | Promise<void>): void {
  callbacks.push(fn);
}

/** Install SIGINT/SIGTERM handlers that run teardown callbacks + kill tracked
 *  children, then exit. `deps` is injectable for tests. Idempotent: a second
 *  signal while shutdown is in flight is a no-op. */
export function installSignalHandlers(
  deps: { on?: OnFn; exit?: ExitFn } = {},
): void {
  const on: OnFn =
    deps.on ?? ((sig, cb) => process.on(sig as NodeJS.Signals, cb));
  const exit: ExitFn = deps.exit ?? ((code) => process.exit(code));
  let shuttingDown = false;
  const handle = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const cb of callbacks) {
      try {
        await cb();
      } catch {
        // best-effort: one teardown failing must not block the rest
      }
    }
    killAllChildren('SIGTERM');
    exit(130);
  };
  on('SIGINT', handle);
  on('SIGTERM', handle);
}
