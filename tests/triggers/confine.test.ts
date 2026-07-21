import { expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  confineWatchPath,
  expandHome,
  WatchPathError,
} from '../../src/triggers/confine.ts';

// realpathSync the base so the assertions hold on macOS (tmpdir is a /var →
// /private/var symlink).
const realBase = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'wr-')));

test('rejects the filesystem root', () => {
  expect(() => confineWatchPath('/', realBase())).toThrow(WatchPathError);
});

test('rejects a path outside the watch root', () => {
  expect(() => confineWatchPath('/etc/passwd', realBase())).toThrow(
    WatchPathError,
  );
});

test('accepts a path under the watch root (real, confined dir)', () => {
  const base = realBase();
  writeFileSync(join(base, 'x.csv'), '');
  expect(confineWatchPath(join(base, 'x.csv'), base)).toBe(join(base, 'x.csv'));
});

test('accepts the watch-root dir itself', () => {
  const base = realBase();
  expect(confineWatchPath(base, base)).toBe(base);
});

test('accepts a not-yet-existing path under the root (resolve fallback)', () => {
  const base = realBase();
  // The file does not exist yet — chokidar may watch a path before creation.
  expect(confineWatchPath(join(base, 'future.csv'), base)).toBe(
    join(base, 'future.csv'),
  );
});

test('rejects a `..` traversal that escapes the root', () => {
  const base = realBase();
  expect(() => confineWatchPath(join(base, '..', 'etc'), base)).toThrow(
    WatchPathError,
  );
});

test('rejects a symlink under the root that escapes to an outside dir', () => {
  const base = realBase();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'out-')));
  writeFileSync(join(outside, 'secret'), '');
  // A link *inside* the confined root that points at an external directory —
  // realpathSync must resolve it and the confinement must still reject the
  // escape (§7.4 symlink-escape probe).
  symlinkSync(outside, join(base, 'link'));
  expect(() => confineWatchPath(join(base, 'link', 'secret'), base)).toThrow(
    WatchPathError,
  );
});

test('rejects a symlinked ANCESTOR with an absent leaf (§7.4 escape)', () => {
  // The common file-trigger case: watch a drop path before the file lands.
  // `link-out` is an in-root symlink to an OUTSIDE dir; `drop.csv` does not
  // exist yet. A plain resolve of the absent leaf would keep the in-root prefix
  // and wrongly ACCEPT; realpathing the nearest existing ancestor (`link-out`)
  // resolves the symlink and the escape must be REJECTED.
  const base = realBase();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'out-')));
  symlinkSync(outside, join(base, 'link-out'));
  expect(() =>
    confineWatchPath(join(base, 'link-out', 'drop.csv'), base),
  ).toThrow(WatchPathError);
});

test('accepts an absent leaf under a REAL (non-symlink) in-root dir', () => {
  // The legit counterpart of the escape above: a not-yet-created file under a
  // genuine in-root subdir must still be ACCEPTED.
  const base = realBase();
  const sub = join(base, 'sub');
  mkdirSync(sub);
  expect(confineWatchPath(join(sub, 'future.csv'), base)).toBe(
    join(sub, 'future.csv'),
  );
});

test('rejects when the base dir does not exist', () => {
  const missing = join(tmpdir(), `wr-missing-${Math.random()}`);
  expect(() => confineWatchPath(join(missing, 'x'), missing)).toThrow(
    WatchPathError,
  );
});

// I4: expandHome resolves the leading ~ against the real home; a literal ~
// never survives to reach realpathSync/confineWatchPath.
test('expandHome resolves the default watch root against home', () => {
  expect(expandHome('~/.agent/inbox')).toBe(join(homedir(), '.agent/inbox'));
  expect(expandHome('/abs/path')).toBe('/abs/path'); // non-~ passes through
});

test('expandHome expands a bare ~ to the home dir', () => {
  expect(expandHome('~')).toBe(homedir());
});

test('expandHome does NOT expand a ~ that is not a leading path segment', () => {
  // `~user` (no slash) and a mid-string ~ must pass through untouched.
  expect(expandHome('~user/x')).toBe('~user/x');
  expect(expandHome('/a/~/b')).toBe('/a/~/b');
});
