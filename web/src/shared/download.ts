/**
 * Triggers a browser "Save As" download of `text` via a synthetic
 * `<a download>` click on a Blob object URL. Per D9, the export route must
 * be *fetched* (Bearer token), never bare-linked (`<a href="/api/...">` would
 * 401 with no Authorization header) — this helper only handles the
 * already-fetched-text → file-download mechanic; the actual `fetch` with the
 * Bearer header happens at the call site (mirrors `attachments.ts`'s
 * raw-`fetch`-because-`apiFetch`-forces-JSON precedent).
 */
export function downloadBlob(
  filename: string,
  text: string,
  mime: string,
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
