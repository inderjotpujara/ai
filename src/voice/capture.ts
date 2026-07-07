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
export function bytesToFloat32(bytes: Uint8Array): Float32Array {
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

const MIC_SAMPLE_RATE = 16000;
/** Hard cap on a single mic capture so the buffer JSON-serialized to the STT worker can't grow unbounded. */
const MAX_CAPTURE_SECONDS = 60;
export const MAX_CAPTURE_SAMPLES = MAX_CAPTURE_SECONDS * MIC_SAMPLE_RATE;

export type MicSession = {
  frames: AsyncIterable<Float32Array>;
  silenceSignaled: Promise<void>;
  stop(): Promise<void>;
};

export type MicIo = {
  start(): Promise<MicSession>;
  onKey(cb: (key: 'space' | 'enter' | 'ctrl-c') => void): () => void;
  print(msg: string): void;
};

/** True if the buffer carries perceptible energy (not TCC-denied silence). */
function hasEnergy(samples: Float32Array): boolean {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak > 0.005;
}

/**
 * Live mic capture: tap [space] to start, then either ffmpeg `silencedetect`
 * (stderr) or a second [space]/[enter] stops the recording; [ctrl-c] cancels.
 * Capture length is capped at `MAX_CAPTURE_SAMPLES` regardless of stop signal.
 */
export async function captureFromMic(
  _cfg: VoiceConfig,
  io: MicIo,
): Promise<VoiceFrames> {
  io.print(
    'tap [space] to start (auto-stops on a pause, or press [space]/[enter] to stop)',
  );

  const chunks: Float32Array[] = [];
  let sampleCount = 0;
  let session: MicSession | undefined;
  let framesDone: Promise<void> = Promise.resolve();

  /** Drains `session.frames` into `chunks`, stopping early once the length cap is hit. */
  async function pumpFrames(s: MicSession): Promise<void> {
    for await (const frame of s.frames) {
      chunks.push(frame);
      sampleCount += frame.length;
      if (sampleCount >= MAX_CAPTURE_SAMPLES) {
        io.print('reached max capture length');
        break;
      }
    }
  }

  /** Normalizes a thrown value into a display string for logging + VoiceError hints. */
  function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stopped = false;
    let recording = false;

    const off = io.onKey((key) => {
      void handleKey(key).catch((err: unknown) => {
        fail('mic key handler failed', err);
      });
    });

    function settleOk() {
      if (settled) return;
      settled = true;
      off();
      resolve();
    }
    function settleErr(err: VoiceError) {
      if (settled) return;
      settled = true;
      off();
      reject(err);
    }
    /**
     * Idempotent: stop() may legitimately be requested from more than one
     * trigger. A stop failure (e.g. ESRCH killing an already-dead process)
     * must never block settling or crash the process.
     */
    async function stopSession() {
      if (stopped) return;
      stopped = true;
      try {
        await session?.stop();
      } catch (err) {
        io.print(`mic stop failed: ${errMessage(err)}`);
      }
    }
    /** Any "we're done recording" trigger funnels here — safe to call more than once. */
    async function finish() {
      if (settled) return;
      await stopSession();
      await framesDone;
      settleOk();
    }
    /** Routes a genuine capture failure to settleErr with the real cause (never the empty/no-energy hint). */
    function fail(context: string, err: unknown) {
      const message = errMessage(err);
      io.print(`${context}: ${message}`);
      settleErr(new VoiceError('microphone capture failed', message));
    }

    async function handleKey(key: 'space' | 'enter' | 'ctrl-c'): Promise<void> {
      if (settled) return;
      if (key === 'ctrl-c') {
        await stopSession();
        settleErr(new VoiceError('cancelled'));
        return;
      }
      if (!recording && key === 'space') {
        recording = true;
        io.print('recording');
        let started: MicSession;
        try {
          started = await io.start();
        } catch (err) {
          settleErr(new VoiceError('could not open microphone', String(err)));
          return;
        }
        session = started;
        framesDone = pumpFrames(started);
        started.silenceSignaled
          .then(finish)
          .catch((err: unknown) => fail('silence detection failed', err));
        framesDone
          .then(finish)
          .catch((err: unknown) => fail('frame capture failed', err));
        return;
      }
      if (recording && (key === 'space' || key === 'enter')) {
        await finish();
      }
    }
  });

  const samples = new Float32Array(sampleCount);
  let offset = 0;
  for (const c of chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  if (sampleCount === 0 || !hasEnergy(samples)) {
    throw new VoiceError(
      'no audio captured from the microphone',
      'grant Microphone access to your terminal app in System Settings → Privacy & Security → Microphone',
    );
  }
  return { samples, sampleRate: MIC_SAMPLE_RATE };
}
