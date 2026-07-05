import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ClipboardRunResult = { ok: boolean; bytes?: Uint8Array };

export type ClipboardCaptureDeps = {
  /** Defaults to `process.platform`; capture only runs on `'darwin'`. */
  platform?: string;
  /** Injectable seam for the actual capture command; real default shells out via osascript/pngpaste. */
  run?: (cmd: string, args: string[]) => Promise<ClipboardRunResult>;
};

/**
 * Real (non-test) clipboard capture: writes the clipboard's PNG representation
 * to a scratch file via `osascript`, falling back to `pngpaste` if that
 * produces nothing, then reads the bytes back and cleans up. Never opens any
 * interactive UI — `osascript`'s `the clipboard as «class PNGf»` reads
 * silently, and failures (no image on the clipboard, tool missing) resolve to
 * `{ ok: false }` rather than throwing.
 */
async function defaultRun(
  _cmd: string,
  _args: string[],
): Promise<ClipboardRunResult> {
  const scratchPath = join(tmpdir(), `clipboard-capture-${randomUUID()}.png`);
  try {
    const script = `set pngData to (the clipboard as «class PNGf»)
set outFile to open for access POSIX file "${scratchPath}" with write permission
set eof of outFile to 0
write pngData to outFile
close access outFile`;
    try {
      await execFileAsync('osascript', ['-e', script]);
    } catch {
      // osascript failed (e.g. no image on the clipboard) — try pngpaste.
      await execFileAsync('pngpaste', [scratchPath]);
    }
    const file = Bun.file(scratchPath);
    if (!(await file.exists())) return { ok: false };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false };
    return { ok: true, bytes };
  } catch {
    return { ok: false };
  } finally {
    await unlink(scratchPath).catch(() => undefined);
  }
}

/**
 * Grabs a copied image (screenshot) off the macOS clipboard without any
 * interactive dialog. Degrades gracefully to `undefined` off-mac or when the
 * clipboard holds no image — never throws.
 */
export async function captureClipboardImage(
  deps?: ClipboardCaptureDeps,
): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
  const platform = deps?.platform ?? process.platform;
  if (platform !== 'darwin') return undefined;

  const run = deps?.run ?? defaultRun;
  const result = await run('osascript', [
    '-e',
    'the clipboard as «class PNGf»',
  ]);
  if (!result.ok || !result.bytes || result.bytes.byteLength === 0) {
    return undefined;
  }
  return { bytes: result.bytes, mediaType: 'image/png' };
}
