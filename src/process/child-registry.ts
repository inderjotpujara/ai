/** Central registry of live child processes. Every long-lived spawn site
 *  (model-server supervision, media generation, voice mic/transcribe
 *  subprocesses) registers here as an additional safety net alongside its
 *  own kill logic, so a process-wide shutdown (SIGINT/SIGTERM handler) can
 *  reach every spawned child even if its owning site never gets to run its
 *  own teardown path. */
type Killable = { kill: (sig?: NodeJS.Signals) => void };

const live = new Set<Killable>();

/** Track a live child; call the returned fn when it exits so we don't kill a dead pid. */
export function registerChild(handle: Killable): () => void {
  live.add(handle);
  return () => {
    live.delete(handle);
  };
}

/** Best-effort terminate every tracked child (used on SIGINT/SIGTERM). */
export function killAllChildren(sig: NodeJS.Signals = 'SIGTERM'): void {
  for (const h of live) {
    try {
      h.kill(sig);
    } catch {
      // already exited
    }
  }
  live.clear();
}

export function childCount(): number {
  return live.size;
}
