import { type VoiceConfig, VoiceError, type VoiceFrames } from './types.ts';

export type CaptureDeps = {
  spawn?: (
    cmd: string[],
  ) => Promise<{ code: number; stdout: Uint8Array; stderr: string }>;
};

async function defaultSpawn(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).bytes(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

/** Reinterprets a byte buffer of little-endian Float32 as a Float32Array (copy for alignment). */
function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

/** Decodes any audio file to mono 16 kHz Float32 via ffmpeg. */
export async function captureFromFile(
  path: string,
  cfg: VoiceConfig,
  deps: CaptureDeps = {},
): Promise<VoiceFrames> {
  const spawn = deps.spawn ?? defaultSpawn;
  const { code, stdout, stderr } = await spawn([
    cfg.ffmpeg,
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'f32le',
    'pipe:1',
  ]);
  if (code !== 0) throw new VoiceError(`ffmpeg decode failed: ${stderr}`);
  const samples = bytesToFloat32(stdout);
  if (samples.length === 0) throw new VoiceError('no audio decoded from file');
  return { samples, sampleRate: 16000 };
}
