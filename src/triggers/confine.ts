/**
 * §7.4 — file-watch path confinement.
 *
 * Every file-trigger path is kept inside the configured watch root
 * (`AGENT_TRIGGERS_WATCH_ROOT`, default `~/.agent/inbox`). The confinement
 * realpaths BOTH the root and the candidate so a `../` traversal or a symlink
 * that escapes the root is rejected — mirroring `confineToDir` in
 * `src/server/security/media-path.ts`. Confinement is re-checked at BOTH
 * trigger-creation time (the API) and watch-start time (`watcher.ts`) — defence
 * in depth.
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

/** A file-trigger watch path resolved to the filesystem root or outside its
 *  confinement root (including via symlink or `../` escape). */
export class WatchPathError extends Error {
  constructor(readonly candidate: string) {
    super(`watch path escapes the confinement root: ${candidate}`);
    this.name = 'WatchPathError';
  }
}

/**
 * Expand a leading `~` (bare or `~/…`) against `os.homedir()`. Any other string
 * — including `~user` and a non-leading `~` — passes through untouched.
 *
 * I4: the default `AGENT_TRIGGERS_WATCH_ROOT` (`~/.agent/inbox`) is STORED with
 * a literal `~` (schema.ts) and expanded HERE, the single `~`-resolution site,
 * so a literal `~` never survives to reach `realpathSync`. Mirrors the `~/…`
 * config-default convention (`AGENT_MEDIA_VENV` et al.).
 */
export function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, homedir());
}

/**
 * Resolve `candidate` and assert it is confined under `baseDir`. The candidate
 * is realpath'd when it exists (defeating symlink escapes) and otherwise
 * `resolve`d (chokidar may watch a path before it is created; a `../` in the
 * literal is still collapsed by `resolve`, so an escape still fails the prefix
 * check). REJECTS with `WatchPathError` when the resolved path is the
 * filesystem root, when `baseDir` cannot be realpath'd, or when the candidate
 * lands outside the root. Callers pass an already-`expandHome`d `baseDir`.
 */
export function confineWatchPath(candidate: string, baseDir: string): string {
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(baseDir));
  } catch {
    // A missing/unreadable root resolves to the same rejection as an escaping
    // candidate rather than throwing a raw ENOENT.
    throw new WatchPathError(candidate);
  }
  let real: string;
  try {
    real = realpathSync(resolve(realRoot, candidate));
  } catch {
    // Not yet on disk. A plain `resolve` would collapse `..` but NOT resolve a
    // symlinked ANCESTOR (e.g. `<root>/link-out/absent.csv` where `link-out` →
    // /outside), letting an escape slip past the prefix check. So walk up to the
    // nearest EXISTING ancestor, realpath THAT (defeating a symlinked ancestor),
    // then re-append the non-existent tail before the prefix check runs.
    const abs = resolve(realRoot, candidate);
    let cur = abs;
    const tail: string[] = [];
    for (;;) {
      try {
        cur = realpathSync(cur);
        break;
      } catch {
        const p = dirname(cur);
        if (p === cur) break;
        tail.unshift(basename(cur));
        cur = p;
      }
    }
    real = tail.length ? join(cur, ...tail) : cur;
  }
  // Reject the filesystem root outright (§7.4), independent of the root check.
  if (real === parse(real).root) {
    throw new WatchPathError(candidate);
  }
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (real !== realRoot && !real.startsWith(prefix)) {
    throw new WatchPathError(candidate);
  }
  return real;
}
