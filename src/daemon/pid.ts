/**
 * PID-file lifecycle for the local agent daemon (Slice 24 Increment 4).
 *
 * Guards against a double-start and backs `daemon status`: `writePid` records
 * the running daemon's pid on start, `readPid`/`isPidAlive` let a caller
 * check whether that pid is still alive, and `clearPid` removes the file on
 * graceful stop. A pid file left behind by a crashed daemon (process no
 * longer alive) is stale — callers should treat that as "not running" and
 * are free to overwrite/clear it rather than refusing to start.
 */

import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Default PID file location: `~/.agent/daemon.pid`. */
export function defaultPidPath(): string {
  return join(homedir(), '.agent', 'daemon.pid');
}

/**
 * Write `pid` to `path`, creating the parent directory if needed.
 * Directory is created with owner-only perms (0700); the pid file itself is
 * 0600 — this file identifies a local process by pid and has no reason to be
 * group/world readable.
 */
export function writePid(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, String(pid), { mode: 0o600 });
}

/**
 * Read + parse the pid at `path`. Returns `undefined` when the file is
 * absent, unreadable, or its contents aren't a positive integer — every
 * failure mode collapses to "no pid on record" rather than throwing, since
 * callers use this for a best-effort double-start guard, not a hard invariant.
 */
export function readPid(path: string): number | undefined {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe whether a process with `pid` is currently running, without sending
 * it a real signal. `process.kill(pid, 0)` is the standard existence check:
 * - succeeds (no throw) → the process exists and we can signal it → alive.
 * - throws `ESRCH` ("no such process") → the process is dead → not alive.
 * - throws `EPERM` ("operation not permitted") → the process exists but is
 *   owned by another user, so we can't signal it → still alive (it's running,
 *   we just don't have permission — treat that as "alive", not "dead").
 * Any other unexpected errno is treated as "not alive" (fail closed: we
 * couldn't confirm liveness, so don't block a restart on it).
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    return false;
  }
}

/**
 * Read the pid file at `path` and return it only if the process it names is
 * actually alive. A pid file whose process is dead is stale (left behind by
 * a crash, not a graceful stop) — this treats that case as "not running" and
 * cleans up the stale file so a subsequent start doesn't need to fight it.
 */
export function readLivePid(path: string): number | undefined {
  const pid = readPid(path);
  if (pid === undefined) return undefined;
  if (isPidAlive(pid)) return pid;
  clearPid(path);
  return undefined;
}

/**
 * The daemon's boot instant, derived from the pid file's mtime (§7.3): the
 * pid is written ONCE at `start()`, so its mtime is the daemon's boot time —
 * robust to WHICH process answers a status request (the responder's own
 * `process.uptime()` would be wrong the moment status is ever proxied). Returns
 * `undefined` when the file is absent/unreadable (every failure → "unknown").
 */
export function readStartedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Remove the pid file at `path`. A no-op (never throws) if it's already gone. */
export function clearPid(path: string): void {
  try {
    rmSync(path);
  } catch {
    // already gone — graceful stop / double-clear is fine
  }
}
