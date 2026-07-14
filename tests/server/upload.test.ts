import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confineToDir } from '../../src/server/security/media-path.ts';
import { handleUpload, MAX_UPLOAD_BYTES } from '../../src/server/upload.ts';

let uploadsDir: string;

beforeEach(() => {
  uploadsDir = mkdtempSync(join(tmpdir(), 'uploads-'));
});

afterEach(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
});

function uploadRequest(file: Blob | string, fieldName = 'file'): Request {
  const form = new FormData();
  form.append(fieldName, file);
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    body: form,
  });
}

test('a valid image upload writes into the confined dir and returns a server-minted uploadId', async () => {
  const file = new File(['fake-png-bytes'], 'photo.png', {
    type: 'image/png',
  });
  const res = await handleUpload(uploadRequest(file), { uploadsDir });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { uploadId: string };
  expect(body.uploadId).toMatch(/^[0-9a-f]{32}\.png$/);
  expect(body.uploadId).not.toBe('photo.png');

  // The file actually landed inside the confined dir, and confineToDir (the
  // same primitive the read side uses) resolves it without throwing.
  const real = confineToDir(body.uploadId, uploadsDir);
  expect(existsSync(real)).toBe(true);
  expect(readdirSync(uploadsDir)).toEqual([body.uploadId]);
});

test('a path-escaping client filename is ignored entirely — the write stays confined', async () => {
  const file = new File(['fake-png-bytes'], '../../../../etc/passwd.png', {
    type: 'image/png',
  });
  const res = await handleUpload(uploadRequest(file), { uploadsDir });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { uploadId: string };
  // The client-declared filename never influences the write path — the
  // uploadId is a fresh server-minted hex name, no traversal segments.
  expect(body.uploadId).not.toContain('..');
  expect(body.uploadId).not.toContain('/');
  expect(body.uploadId).toMatch(/^[0-9a-f]{32}\.png$/);

  // Only the one safely-named file exists inside the confined dir; nothing
  // escaped to a parent directory.
  expect(readdirSync(uploadsDir)).toEqual([body.uploadId]);
  expect(() => confineToDir(body.uploadId, uploadsDir)).not.toThrow();
});

test('a symlink planted inside the uploads dir cannot be used to read outside it (read-side confinement, defense in depth)', () => {
  // This mirrors tests/server/media-path.test.ts's symlink-escape guard,
  // applied to the SAME dir handleUpload writes into: even if something
  // (or someone with local access) plants a symlink inside uploadsDir, the
  // shared confineToDir primitive still refuses to resolve outside it.
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'SECRET');
  symlinkSync(join(outside, 'secret.txt'), join(uploadsDir, 'escape.png'));

  expect(() => confineToDir('escape.png', uploadsDir)).toThrow();
});

test('a non-image media type is rejected with 400', async () => {
  const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
  const res = await handleUpload(uploadRequest(file), { uploadsDir });

  expect(res.status).toBe(400);
  expect(readdirSync(uploadsDir)).toEqual([]);
});

test('an oversize upload is rejected with 400', async () => {
  const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  const file = new File([oversized], 'big.png', { type: 'image/png' });
  const res = await handleUpload(uploadRequest(file), { uploadsDir });

  expect(res.status).toBe(400);
  expect(readdirSync(uploadsDir)).toEqual([]);
});

test('an oversize Content-Length is rejected with 400 BEFORE the body is parsed', async () => {
  // A lying Content-Length header far over the cap must 400 without ever
  // reaching formData() — prove it by pointing the request body at a stream
  // that THROWS if read, so a pass requires the precheck to short-circuit.
  const exploding = new ReadableStream({
    pull() {
      throw new Error('body must not be read: precheck should have rejected');
    },
  });
  const req = new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': String(MAX_UPLOAD_BYTES * 4),
    },
    body: exploding,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const res = await handleUpload(req, { uploadsDir });
  expect(res.status).toBe(400);
  expect(readdirSync(uploadsDir)).toEqual([]);
});

test('a missing file field is rejected with 400', async () => {
  const form = new FormData();
  form.append('not-the-file-field', 'hello');
  const req = new Request('http://localhost/api/upload', {
    method: 'POST',
    body: form,
  });
  const res = await handleUpload(req, { uploadsDir });
  expect(res.status).toBe(400);
});
