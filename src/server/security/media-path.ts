import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** A network-supplied media path resolved outside its allowed directory. */
export class MediaPathError extends Error {
  constructor(readonly candidate: string) {
    super(`media path escapes the allowed directory: ${candidate}`);
    this.name = 'MediaPathError';
  }
}

/**
 * Resolve `candidate` (relative to `root`, or absolute) and assert its REALPATH
 * is `root` itself or a descendant of it — defeating `../` traversal and symlink
 * escapes. Used to confine network-supplied media to the run/upload dir; the
 * server also disables `ingestMedia`'s filesystem auto-detect (that wiring lands
 * with the chat/media endpoints in a later phase — this util is its primitive).
 */
export function confineToDir(candidate: string, root: string): string {
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(root));
  } catch {
    // A missing ROOT dir (fresh install with no runs/ or uploads/ yet) must
    // resolve to the same MediaPathError → 404 path as a missing candidate,
    // not throw a raw ENOENT that bubbles to a 500.
    throw new MediaPathError(candidate);
  }
  let real: string;
  try {
    real = realpathSync(resolve(realRoot, candidate));
  } catch {
    throw new MediaPathError(candidate);
  }
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (real !== realRoot && !real.startsWith(prefix)) {
    throw new MediaPathError(candidate);
  }
  return real;
}
