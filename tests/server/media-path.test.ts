import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  confineToDir,
  MediaPathError,
} from '../../src/server/security/media-path.ts';

test('a file inside the root resolves to its realpath', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mp-')));
  writeFileSync(join(root, 'upload.png'), 'x');
  expect(confineToDir('upload.png', root)).toBe(join(root, 'upload.png'));
});

test('a ../ traversal is rejected', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mp-')));
  expect(() => confineToDir('../../etc/passwd', root)).toThrow(MediaPathError);
});

test('an absolute path outside the root is rejected', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mp-')));
  expect(() => confineToDir('/etc/hosts', root)).toThrow(MediaPathError);
});

test('a symlink escaping the root is rejected', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mp-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'out-')));
  writeFileSync(join(outside, 'secret.txt'), 's');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  expect(() => confineToDir('link.txt', root)).toThrow(MediaPathError);
});
