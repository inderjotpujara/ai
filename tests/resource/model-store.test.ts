import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isProjectStoreActive,
  projectStorePath,
} from '../../src/resource/model-store.ts';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir !== undefined) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

test('empty dir → isProjectStoreActive returns false', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'model-store-test-'));
  expect(isProjectStoreActive(tempDir)).toBe(false);
});

test('dir with blobs subdir → isProjectStoreActive returns true', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'model-store-test-'));
  mkdirSync(join(tempDir, 'blobs'));
  expect(isProjectStoreActive(tempDir)).toBe(true);
});

test('dir with manifests subdir → isProjectStoreActive returns true', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'model-store-test-'));
  mkdirSync(join(tempDir, 'manifests'));
  expect(isProjectStoreActive(tempDir)).toBe(true);
});

test('projectStorePath ends with model-images', () => {
  expect(projectStorePath().endsWith('model-images')).toBe(true);
});
