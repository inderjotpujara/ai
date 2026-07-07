/** Real (non-test) voice adapters: ffmpeg-backed file/mic capture, the
 *  in-process/subprocess transcriber, and a raw-TTY key reader — the
 *  platform glue `ingestVoice` (src/voice/ingest.ts) runs against from the
 *  CLI. Not unit-tested here (spawning real ffmpeg / raw stdin would be
 *  brittle); exercised end-to-end at live-verify (Task 13). */
import type { DegradationLedger } from '../reliability/ledger.ts';
import type { MicIo, MicSession } from './capture.ts';
import { captureFromFile, captureFromMic, carryPcmChunk } from './capture.ts';
import type { VoiceIngestDeps } from './ingest.ts';
import { ffmpegCmd, resolveVoiceModel } from './model.ts';
import { createTranscriber } from './transcribe.ts';
import type { Transcriber, VoiceConfig } from './types.ts';

type Env = Record<string, string | undefined>;

/** Voice-specific wall-clock default. Distinct from the media pipeline's
 *  10-minute default (src/media/*): a single capture/transcribe turn is
 *  interactive, so it fails fast instead of hanging a chat session.
 *  AGENT_MEDIA_TIMEOUT_MS is reused as the override knob (one timeout env,
 *  shared across every media/voice subprocess) rather than inventing a
 *  voice-only variable. */
const DEFAULT_VOICE_TIMEOUT_MS = 30_000;

/** Assembles the `VoiceConfig` (model dir, ffmpeg binary, timeout) real deps
 *  are built from. */
export function resolveVoiceConfig(env: Env = process.env): VoiceConfig {
  return {
    modelDir: resolveVoiceModel(env),
    ffmpeg: ffmpegCmd(env),
    timeoutMs: Number(env.AGENT_MEDIA_TIMEOUT_MS) || DEFAULT_VOICE_TIMEOUT_MS,
  };
}

/** ffmpeg avfoundation mic index. `AGENT_MIC_INDEX` overrides; default `0`
 *  (the system default input device on macOS). */
function micIndex(env: Env): string {
  return env.AGENT_MIC_INDEX ?? '0';
}

/**
 * Real `MicIo`: spawns ffmpeg against `avfoundation` to stream mono 16 kHz
 * f32le PCM on stdout, and watches its stderr for `silencedetect` markers to
 * auto-stop the capture.
 *
 * Auto-stop heuristic: ffmpeg's `silencedetect` filter logs `silence_start`
 * when the signal drops below the noise floor and `silence_end` when it
 * rises back above it. A session opens amid ambient silence, so the FIRST
 * `silence_start` would fire almost immediately and cut the recording
 * before the user speaks. Instead we require a `silence_end` (speech
 * started) to have been observed before the next `silence_start` (speech
 * stopped) resolves `silenceSignaled` — i.e. "stop on the first pause AFTER
 * the user has said something." If silencedetect never fires (e.g. no
 * device, or the OS mic-permission prompt swallows the stream) the promise
 * simply never resolves; `captureFromMic` still ends via manual
 * space/enter or the hard `MAX_CAPTURE_SAMPLES` cap, so this is a
 * best-effort convenience, not a correctness dependency.
 */
function createMicIo(cfg: VoiceConfig, env: Env): MicIo {
  return {
    async start(): Promise<MicSession> {
      const child = Bun.spawn(
        [
          cfg.ffmpeg,
          '-hide_banner',
          '-loglevel',
          'info',
          '-f',
          'avfoundation',
          '-i',
          `:${micIndex(env)}`,
          '-ac',
          '1',
          '-ar',
          '16000',
          '-af',
          'silencedetect=noise=-35dB:d=0.8',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      const silenceSignaled = new Promise<void>((resolve) => {
        let sawSpeech = false;
        (async () => {
          const reader = (
            child.stderr as ReadableStream<Uint8Array>
          ).getReader();
          const decoder = new TextDecoder();
          let buf = '';
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return;
              buf += decoder.decode(value, { stream: true });
              let idx = buf.indexOf('\n');
              while (idx >= 0) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                if (line.includes('silence_end')) sawSpeech = true;
                else if (line.includes('silence_start') && sawSpeech) {
                  resolve();
                  return;
                }
                idx = buf.indexOf('\n');
              }
            }
          } catch {
            // stderr closed/errored — leave silenceSignaled unresolved; the
            // manual-stop / max-length paths in captureFromMic still apply.
          } finally {
            // Mirror frames()'s cleanup: release the lock on every exit path
            // (done, silence resolved, or errored) so nothing else holding a
            // reference to child.stderr is left with a dangling lock.
            reader.releaseLock();
          }
        })();
      });

      async function* frames(): AsyncIterable<Float32Array> {
        const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
        // A pipe read is not guaranteed 4-byte aligned. Carry any leftover
        // 1-3 bytes from the previous chunk forward so a misaligned split
        // never drops a partial sample or desyncs the byte-phase of the
        // chunks that follow (see carryPcmChunk in capture.ts). Any <4-byte
        // remainder at stream end is correctly discarded (never consumed).
        let leftover: Uint8Array = new Uint8Array(0);
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            const result = carryPcmChunk(leftover, value);
            leftover = result.leftover;
            if (result.floats.length > 0) yield result.floats;
          }
        } finally {
          reader.releaseLock();
        }
      }

      return {
        frames: frames(),
        silenceSignaled,
        async stop() {
          try {
            child.kill('SIGTERM');
          } catch {
            // already exited (ESRCH-equivalent) — stop() is best-effort.
          }
          await child.exited;
        },
      };
    },
    onKey(cb) {
      const stdin = process.stdin;
      const wasRaw = stdin.isTTY ? stdin.isRaw : undefined;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const onData = (data: Buffer) => {
        for (const byte of data) {
          if (byte === 0x20) cb('space');
          else if (byte === 0x0d || byte === 0x0a) cb('enter');
          else if (byte === 0x03) cb('ctrl-c');
        }
      };
      stdin.on('data', onData);
      let unsubscribed = false;
      const restore = () => {
        // Idempotent: safe to call more than once (e.g. a caller unsubscribes
        // in both a success and a finally path, or the exit backstop below
        // fires after a normal unsubscribe already ran).
        if (unsubscribed) return;
        unsubscribed = true;
        stdin.off('data', onData);
        if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw);
        // Restoring cooked mode alone leaves stdin flowing with no consumer —
        // a keystroke arriving before the next readline prompt (e.g. the
        // askYesNo prompts in chat's main()) would otherwise be silently
        // dropped. Pause so stdin sits idle until the next reader resumes it.
        stdin.pause();
      };
      // Backstop: an unexpected process exit mid-capture (uncaught
      // exception, unhandled rejection, signal) must not leave the terminal
      // stuck in raw mode for the user's shell. `restore` is idempotent, so
      // this is harmless if the normal unsubscribe path already ran.
      process.once('exit', restore);
      return () => {
        process.removeListener('exit', restore);
        restore();
      };
    },
    print(msg) {
      console.error(msg);
    },
  };
}

/** Real `VoiceIngestDeps` for the CLI: ffmpeg-backed file capture, a real
 *  mic (avfoundation + raw-TTY keys), and the configured transcriber.
 *  Callers own the returned `transcriber` and must `close()` it once
 *  ingestion is done (the addon/worker holds real resources). */
export function createCliVoiceDeps(
  ledger?: DegradationLedger,
  env: Env = process.env,
): VoiceIngestDeps & { transcriber: Transcriber } {
  const cfg = resolveVoiceConfig(env);
  const transcriber = createTranscriber(cfg, env);
  const io = createMicIo(cfg, env);
  return {
    captureFile: (path) => captureFromFile(path, cfg),
    captureMic: () => captureFromMic(cfg, io),
    transcriber,
    ledger,
  };
}
