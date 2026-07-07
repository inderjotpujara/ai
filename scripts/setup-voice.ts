#!/usr/bin/env bun
/**
 * setup-voice — idempotent voice model provisioning.
 *
 *   bun run setup:voice
 *
 * Downloads the default sherpa-onnx STT model (moonshine-tiny) for voice input.
 * Idempotent by design — safe to re-run. Only network failures are gracefully
 * logged; model readiness is checked before download and polling happens
 * after extraction, so a partial / stalled download on a retry is skipped.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_VOICE_MODEL, voiceCacheDir } from '../src/voice/model.ts';

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

/** Download URL for a model name in the sherpa-onnx `asr-models` release. */
export function modelUrl(name: string): string {
  return `${RELEASE}/${name}.tar.bz2`;
}

/** A model dir is ready when its tokens.txt marker exists. */
export function isModelReady(dir: string, exists: (p: string) => boolean = existsSync): boolean {
  return exists(join(dir, 'tokens.txt'));
}

/** Streams a shell command; resolves the exit code, never throws. */
async function run(cmd: string[]): Promise<number> {
  const p = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  return await p.exited;
}

async function ensureFfmpeg(): Promise<void> {
  if (Bun.which('ffmpeg')) return;
  console.error('⚠ ffmpeg not found.');
  if (process.platform === 'darwin' && Bun.which('brew')) {
    console.error('Installing ffmpeg via brew...');
    const brewCode = await run(['brew', 'install', 'ffmpeg']);
    if (brewCode !== 0) {
      console.error('ffmpeg install failed — voice capture will be unavailable.');
    }
  } else {
    console.error('Install ffmpeg manually (voice capture needs it).');
  }
}

async function main(): Promise<void> {
  await ensureFfmpeg();
  const dir = join(voiceCacheDir(), DEFAULT_VOICE_MODEL);
  if (isModelReady(dir)) {
    console.error(`Voice model already present: ${dir}`);
    return;
  }
  await mkdir(voiceCacheDir(), { recursive: true });
  const archive = join(voiceCacheDir(), `${DEFAULT_VOICE_MODEL}.tar.bz2`);
  console.error(`Downloading ${DEFAULT_VOICE_MODEL}...`);
  if ((await run(['curl', '-L', '-o', archive, modelUrl(DEFAULT_VOICE_MODEL)])) !== 0) {
    console.error('Download failed — voice input will be unavailable until it succeeds.');
    return;
  }
  const tarCode = await run(['tar', '-xjf', archive, '-C', voiceCacheDir()]);
  if (tarCode !== 0) {
    console.error('Extraction failed.');
    return;
  }
  console.error(isModelReady(dir) ? `Voice model ready: ${dir}` : 'Extraction incomplete.');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
