#!/usr/bin/env bun
/**
 * setup-media — out-of-the-box multimodal setup, one command.
 *
 *   bun run setup:media
 *
 * Installs everything the framework's media engines need so a first-time
 * clone gets working STT, image-gen, and TTS, plus (isolated) video-gen:
 *   - `ffmpeg` (system binary, via Homebrew on macOS)
 *   - a "media" venv: mlx-whisper (STT), mflux (image gen), mlx-audio +
 *     misaki[en] (Kokoro TTS)
 *   - a separate "video" venv: mlx-video (+ a pinned transformers version —
 *     see `ensureVideoVenv` below for why it must be its own venv)
 *
 * `src/media/cmd-resolve.ts` is what actually consumes these venvs at
 * runtime: each media strategy's default `cmd` resolves to the matching
 * venv's binary when present, falling back to a bare PATH lookup otherwise.
 *
 * Idempotent by design — safe to re-run. Only user secrets/licenses (HF
 * login + gated-model license acceptance) are left as manual, printed steps;
 * this script cannot and must not do those on the user's behalf.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_MEDIA_VENV = join(homedir(), '.cache/ai/media-venv');
const DEFAULT_VIDEO_VENV = join(homedir(), '.cache/ai/media-video-venv');

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Spawns `cmd`, streaming its stdio straight through, and resolves to its
 *  exit code (never throws on a non-zero exit — callers decide how to react). */
async function run(cmd: string[]): Promise<number> {
  log(`  $ ${cmd.join(' ')}`);
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  return proc.exited;
}

async function ensureFfmpeg(): Promise<void> {
  if (Bun.which('ffmpeg')) {
    log('[ffmpeg] already installed, skipping.');
    return;
  }
  if (process.platform !== 'darwin') {
    log(
      '[ffmpeg] not found and this is not macOS — install ffmpeg manually ' +
        "via your platform's package manager, then re-run this script.",
    );
    return;
  }
  if (!Bun.which('brew')) {
    log(
      '[ffmpeg] Homebrew not found on PATH. Install Homebrew ' +
        '(https://brew.sh) or ffmpeg itself manually, then re-run this ' +
        'script. Continuing without ffmpeg for now.',
    );
    return;
  }
  log('[ffmpeg] not found — installing via Homebrew...');
  const code = await run(['brew', 'install', 'ffmpeg']);
  if (code !== 0) {
    log(
      `[ffmpeg] 'brew install ffmpeg' exited with code ${code} — install ` +
        'manually if video/audio media features need it.',
    );
    return;
  }
  log('[ffmpeg] installed.');
}

/** Creates the venv at `path` if it doesn't exist yet. Returns whether it
 *  already existed (so callers can decide whether the heavy pip install
 *  step is still needed). */
async function ensureVenvDir(path: string): Promise<boolean> {
  if (existsSync(path)) return true;
  log(`[venv] creating ${path}...`);
  const code = await run(['python3', '-m', 'venv', path]);
  if (code !== 0) {
    throw new Error(`failed to create venv at ${path} (exit code ${code})`);
  }
  return false;
}

/** The "media" venv: STT (mlx-whisper), image-gen (mflux), TTS (mlx-audio +
 *  misaki[en] for Kokoro's G2P). Idempotency marker: the venv dir exists AND
 *  its `mlx_whisper` console-script binary is present — a re-run with a
 *  half-created venv (dir present, binary missing) still (re)installs. */
async function ensureMediaVenv(): Promise<void> {
  const venvPath = process.env.AGENT_MEDIA_VENV ?? DEFAULT_MEDIA_VENV;
  const marker = join(venvPath, 'bin', 'mlx_whisper');
  const dirExisted = await ensureVenvDir(venvPath);
  if (dirExisted && existsSync(marker)) {
    log(`[media-venv] ${venvPath} already set up, skipping install.`);
    return;
  }
  log(
    `[media-venv] installing mlx-whisper, mflux, mlx-audio, misaki[en] ` +
      `into ${venvPath}...`,
  );
  const pip = join(venvPath, 'bin', 'pip');
  const code = await run([
    pip,
    'install',
    '-q',
    '--upgrade',
    'pip',
    'mlx-whisper',
    'mflux',
    'mlx-audio',
    'misaki[en]',
  ]);
  if (code !== 0) {
    throw new Error(`media venv pip install failed (exit code ${code})`);
  }
  log('[media-venv] done.');
}

/** The "video" venv: mlx-video, kept ISOLATED from the media venv above.
 *
 *  Why isolated: mlx-video depends on `mlx_vlm`, which (as of this writing)
 *  is incompatible with transformers 5.13's `register` API — installing
 *  mlx-video pulls in whatever transformers version its own dependency
 *  resolver happens to pick, which can land on 5.13+ and break. Pinning
 *  `transformers==5.5.0` is the last version known to work with mlx_vlm's
 *  usage of `register`. The pin runs as a SEPARATE pip install AFTER the
 *  mlx-video install (never combined into one command, never before) so it
 *  wins regardless of what mlx-video's resolver picked. Since the media
 *  venv needs its own (independently resolved) transformers version for its
 *  own packages, this exact conflict is why video-gen gets its own venv
 *  rather than sharing the media venv.
 *
 *  Idempotency marker: mlx-video has no single guaranteed console-script
 *  binary to probe (it's invoked as `mlx_video.ltx_2.generate`, a
 *  `python -m`-style module path, not an installed executable), so unlike
 *  the media venv we can't reuse a "check for a binary" marker. Instead this
 *  writes its own sentinel file once the install completes; that sentinel's
 *  presence is what a re-run checks. */
async function ensureVideoVenv(): Promise<void> {
  const venvPath = process.env.AGENT_MEDIA_VIDEO_VENV ?? DEFAULT_VIDEO_VENV;
  const marker = join(venvPath, '.setup-media-installed');
  const dirExisted = await ensureVenvDir(venvPath);
  if (dirExisted && existsSync(marker)) {
    log(`[video-venv] ${venvPath} already set up, skipping install.`);
    return;
  }
  const pip = join(venvPath, 'bin', 'pip');

  log(`[video-venv] installing mlx-video into ${venvPath}...`);
  const installCode = await run([
    pip,
    'install',
    'git+https://github.com/Blaizzy/mlx-video.git',
  ]);
  if (installCode !== 0) {
    throw new Error(`mlx-video install failed (exit code ${installCode})`);
  }

  // Order matters — see the function doc comment above: this pin MUST run
  // as its own step after the mlx-video install, not merged into it.
  log('[video-venv] pinning transformers==5.5.0 (post mlx-video install)...');
  const pinCode = await run([pip, 'install', 'transformers==5.5.0']);
  if (pinCode !== 0) {
    throw new Error(`transformers==5.5.0 pin failed (exit code ${pinCode})`);
  }

  await Bun.write(marker, `installed ${new Date().toISOString()}\n`);
  log('[video-venv] done.');
}

function printManualSteps(): void {
  const mediaVenv = process.env.AGENT_MEDIA_VENV ?? DEFAULT_MEDIA_VENV;
  log('');
  log(
    '=== Manual steps (yours to do — never share tokens with an AI chat) ===',
  );
  log(
    '1. Image generation already works OUT OF THE BOX, no HuggingFace ' +
      'account needed: the default model is an ungated mirror ' +
      '(dhairyashil/FLUX.1-schnell-mflux-4bit).',
  );
  log(
    '2. Only if you want to switch to a GATED model variant (e.g. ' +
      'black-forest-labs/FLUX.1-schnell or FLUX.1-dev, via ' +
      'AGENT_IMAGE_MODEL) do you need to, in YOUR OWN terminal:',
  );
  log(
    `     a. Run 'huggingface-cli login' (available at ${join(mediaVenv, 'bin', 'huggingface-cli')}, ` +
      'bundled transitively via huggingface_hub) and paste your HF token ' +
      'there. NEVER paste a HuggingFace token into an AI chat/assistant.',
  );
  log("     b. Accept that model's license on huggingface.co in your browser.");
  log('=== setup-media: done ===');
}

async function main(): Promise<void> {
  log('=== setup-media: out-of-the-box multimodal setup ===');
  await ensureFfmpeg();
  await ensureMediaVenv();
  await ensureVideoVenv();
  printManualSteps();
}

main().catch((err) => {
  log(`setup-media failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
