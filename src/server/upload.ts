import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { json } from './app.ts';
import { confineToDir, MediaPathError } from './security/media-path.ts';

/** Hard cap on an uploaded image's byte size (20 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Multipart framing overhead margin: the request body is larger than the
 *  file itself (boundary, headers, field name). Allow a generous slack over
 *  the file cap for the cheap Content-Length precheck so a legitimate
 *  at-the-cap upload is not rejected by framing bytes; the exact `file.size`
 *  check downstream is the precise gate. */
const CONTENT_LENGTH_MARGIN_BYTES = 1024 * 1024;

/** The ONLY media types this endpoint accepts. The extension used for the
 *  server-minted filename comes from this table, never from the client's
 *  declared filename. */
const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type UploadDeps = { uploadsDir: string };

/**
 * `POST /api/upload` — a CONFINED image upload (media-by-reference, Slice
 * 30b Phase 2 Task 16). Security posture:
 *  - the client's filename is NEVER read or trusted for the write path —
 *    the server mints its own id (`randomBytes(16)` + an extension derived
 *    from the VALIDATED `mediaType`), so a crafted `../../etc/passwd`-style
 *    filename simply has no effect;
 *  - only an image-mediaType allowlist is accepted (png/jpeg/webp/gif);
 *  - a byte-size cap rejects oversize uploads before they're written;
 *  - the write path is re-validated through `confineToDir` (the same
 *    primitive `handleChat` uses on the READ side to resolve an upload id
 *    back to a path) as a defense-in-depth regression guard.
 * Returns `{ uploadId }`: an opaque filename the browser threads through
 * `sendMessage({ body: { uploadIds } })` on the NEXT chat turn — the server
 * never accepts a raw filesystem path from the browser (D17).
 */
export async function handleUpload(
  req: Request,
  deps: UploadDeps,
): Promise<Response> {
  // Cheap precheck: reject an oversize body via its declared Content-Length
  // BEFORE `req.formData()` buffers the whole thing into memory. A lying or
  // absent header falls through to the exact `file.size` check below (defense
  // in depth), so this is a fast-path DoS guard, not the authoritative gate.
  const contentLength = Number(req.headers.get('content-length'));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_UPLOAD_BYTES + CONTENT_LENGTH_MARGIN_BYTES
  ) {
    return json({ error: 'invalid upload: file too large' }, 400);
  }

  let form: Awaited<ReturnType<Request['formData']>>;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'invalid upload: expected multipart form data' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return json({ error: 'invalid upload: missing file field' }, 400);
  }

  const ext = EXT_BY_MEDIA_TYPE[file.type];
  if (!ext) {
    return json(
      { error: `invalid upload: unsupported media type ${file.type}` },
      400,
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: 'invalid upload: file too large' }, 400);
  }

  const uploadId = `${randomBytes(16).toString('hex')}.${ext}`;
  mkdirSync(deps.uploadsDir, { recursive: true });
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(join(deps.uploadsDir, uploadId), bytes);

  try {
    // Defense in depth: re-resolve the just-written file through the SAME
    // confinement primitive the read side (`handleChat`) uses. `uploadId` is
    // entirely server-minted (hex digits + a table-derived extension, no
    // path separators), so this can never actually throw in practice — it's
    // a regression guard against a future change to id generation, not the
    // primary control.
    confineToDir(uploadId, deps.uploadsDir);
  } catch (err) {
    if (err instanceof MediaPathError) {
      return json({ error: 'invalid upload: path confinement failed' }, 400);
    }
    throw err;
  }

  return json({ uploadId });
}
