import { UploadResponseSchema } from '@contracts';
import { sessionToken } from '../../shared/contract/client.ts';

/** Raised when `POST /api/upload` rejects the file (bad type, oversize, or
 *  a transport error) — the composer degrades to "no attachment" on this,
 *  per D17 (no raw-filesystem-path fallback over HTTP). */
export class UploadError extends Error {
  override name = 'UploadError';
  constructor(readonly status: number) {
    super(`upload failed with status ${status}`);
  }
}

/**
 * Uploads one image file to the confined `POST /api/upload` endpoint and
 * returns the server-minted `uploadId`. Uses raw `fetch` (not the shared
 * `apiFetch` helper) because the body here is `multipart/form-data`, not
 * JSON — `apiFetch` unconditionally `JSON.stringify`s its body.
 */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken()}` },
    body: form,
  });
  if (!res.ok) throw new UploadError(res.status);

  const parsed = UploadResponseSchema.parse(await res.json());
  return parsed.uploadId;
}
