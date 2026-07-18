/**
 * Central, documented schema for every `AGENT_*` env knob (Slice 30a, Ops
 * Surface Task 2 — was ~63 scattered `process.env.AGENT_*` reads, each with
 * its own ad-hoc default and no single place to see "what can I tune").
 *
 * Scope: this module is the documented contract + a validate-once loader +
 * the `bun run config` dump. It does NOT migrate the existing per-module
 * `process.env` read sites (reliability/config.ts, memory/*, verification/*,
 * etc.) onto `loadConfig` — those keep reading `process.env` directly today.
 * That migration is a tracked follow-on. Every default below is transcribed
 * from the real read site so this stays a source of truth, not a second,
 * drifting copy — see each entry's `doc` for the read site and any caveat.
 */

export type ConfigKind = 'number' | 'boolean' | 'string';

export type ConfigEntry = {
  env: string;
  kind: ConfigKind;
  def: number | boolean | string;
  doc: string;
  /**
   * Marks a default-OFF boolean whose REAL read site uses a stricter `=== '1'`
   * check (e.g. AGENT_MCP_AUTO_APPROVE, AGENT_PROVISION_AUTO_YES). The schema
   * `coerce` rule below is unchanged (any non-`0`/`false` reads true); this flag
   * only lets a future settings UI surface the stricter real-world semantics.
   */
  strict?: boolean;
};

/**
 * The documented source of truth for every AGENT_* knob, grouped by concern.
 * Boolean convention (mirrors `media/policy.ts` `uncensoredEnabled` and
 * `telemetry/provider.ts` `recordIoEnabled`): a default-on boolean reads
 * false only when the raw value is exactly `'0'` or `'false'`
 * (case-insensitive); anything else (including unset) is true. A handful of
 * booleans below are default-OFF in the real code and only flip on `'1'`
 * exactly (`AGENT_MCP_AUTO_APPROVE`, `AGENT_PROVISION_AUTO_YES`) — `coerce`'s
 * uniform rule (see below) treats any non-`0`/`false` value as `true` for
 * those too, which is a deliberate simplification of the schema layer noted
 * in each entry's doc; the real read sites keep their stricter `=== '1'` check.
 */
export const CONFIG_SPEC: ConfigEntry[] = [
  // --- Core / delegation guardrails (src/core/guardrails.ts) ---
  {
    env: 'AGENT_MAX_DELEGATION_DEPTH',
    kind: 'number',
    def: 5,
    doc: 'Max router→specialist delegation depth (core/guardrails.ts maxDelegationDepth).',
  },
  {
    env: 'AGENT_RETURN_CTX_FRACTION',
    kind: 'number',
    def: 0.25,
    doc: "Fraction of the caller's context a single delegate return may occupy (core/guardrails.ts returnCtxFraction).",
  },

  // --- Reliability (src/reliability/config.ts) ---
  {
    env: 'AGENT_MAX_ATTEMPTS',
    kind: 'number',
    def: 4,
    doc: 'Max attempts for a cross-boundary op withRetry owns (not LLM turns).',
  },
  {
    env: 'AGENT_RUN_TIMEOUT_MS',
    kind: 'number',
    def: 120_000,
    doc: 'Hard wall-clock cap for a single agent turn / step attempt.',
  },
  {
    env: 'AGENT_IDLE_TIMEOUT_MS',
    kind: 'number',
    def: 90_000,
    doc: 'Idle-stall cap for a progress-bearing op; resets on observed progress.',
  },
  {
    env: 'AGENT_BREAKER_THRESHOLD',
    kind: 'number',
    def: 5,
    doc: 'Consecutive failures before a circuit breaker opens.',
  },
  {
    env: 'AGENT_BREAKER_COOLDOWN_MS',
    kind: 'number',
    def: 60_000,
    doc: 'How long an open breaker waits before allowing a half-open probe.',
  },
  {
    env: 'AGENT_BREAKER_HALF_OPEN_PROBES',
    kind: 'number',
    def: 1,
    doc: 'Successful half-open probes required to close a breaker.',
  },
  {
    env: 'AGENT_RETRY_BASE_MS',
    kind: 'number',
    def: 1_000,
    doc: 'Base backoff for retry.ts full-jitter exponential retry.',
  },
  {
    env: 'AGENT_RETRY_CAP_MS',
    kind: 'number',
    def: 45_000,
    doc: 'Backoff cap for retry.ts.',
  },
  {
    env: 'AGENT_PROBE_TIMEOUT_MS',
    kind: 'number',
    def: 1_500,
    doc: 'Liveness-probe timeout (runtime isAvailable / listModels).',
  },
  {
    env: 'AGENT_DOWNLOAD_ATTEMPTS',
    kind: 'number',
    def: 6,
    doc: 'Attempts for a model/asset download (reliability/download-retry.ts).',
  },
  {
    env: 'AGENT_DOWNLOAD_STALL_MS',
    kind: 'number',
    def: 90_000,
    doc: 'Idle/stall timeout for a download with no byte progress.',
  },

  // --- Memory / RAG (src/memory/*) ---
  {
    env: 'AGENT_MEMORY_PATH',
    kind: 'string',
    def: 'memory',
    doc: 'Directory for the memory store (memory/define.ts defineMemory).',
  },
  {
    env: 'AGENT_MEMORY_EMBED_MODEL',
    kind: 'string',
    def: 'qwen3-embedding:0.6b',
    doc: 'Embedding model id for memory ingest/recall (memory/define.ts).',
  },
  {
    env: 'AGENT_MEMORY_CTX_FRACTION',
    kind: 'number',
    def: 0.25,
    doc: "Fraction of the caller's context retrieved memory may occupy (memory/budget.ts retrievalCtxFraction).",
  },
  {
    env: 'AGENT_MEMORY_TOP_K',
    kind: 'number',
    def: 6,
    doc: 'Ceiling on returned recall results; budget may return fewer (memory/retrieve.ts).',
  },
  {
    env: 'AGENT_MEMORY_RERANK',
    kind: 'boolean',
    def: true,
    doc: "Enable reranking on recall; '0' disables (memory/retrieve.ts defaultRerank).",
  },

  // --- Session persistence (src/session/*, Slice 30b Phase 6) ---
  {
    env: 'AGENT_SESSIONS_PATH',
    kind: 'string',
    def: 'sessions',
    doc: 'Directory for the session/chat-history SQLite store (session/store.ts createSessionStore), mirroring AGENT_MEMORY_PATH.',
  },

  // --- Verification / anti-hallucination (src/verification/config.ts) ---
  {
    env: 'AGENT_VERIFY_MODEL',
    kind: 'string',
    def: 'bespoke-minicheck',
    doc: 'Faithfulness-judge model id for claim verification.',
  },
  {
    env: 'AGENT_VERIFY_THRESHOLD',
    kind: 'number',
    def: 0.9,
    doc: 'Minimum claim-support score to pass verification (0,1].',
  },
  {
    env: 'AGENT_VERIFY_MAX_RETRIES',
    kind: 'number',
    def: 1,
    doc: 'Max corrective-RAG retries before abstaining.',
  },
  {
    env: 'AGENT_VERIFY_ENABLED',
    kind: 'boolean',
    def: true,
    doc: "Master switch for the verification layer; '0' disables.",
  },
  {
    env: 'AGENT_VERIFY_AUTO_PULL',
    kind: 'string',
    def: 'prompt',
    doc: "Auto-pull policy for a missing verify model: '1'=always, '0'=never, else 'prompt' (verification/config.ts autoPullPolicy).",
  },

  // --- Verified-build gate (src/verified-build/config.ts) ---
  {
    env: 'AGENT_DRY_RUN_MS',
    kind: 'number',
    def: 45_000,
    doc: 'Wall-clock cap for a builder dry-run execution.',
  },
  {
    env: 'AGENT_BUILD_MAX_REPAIRS',
    kind: 'number',
    def: 2,
    doc: 'Max self-repair regeneration attempts on a failed dry-run.',
  },
  {
    env: 'AGENT_REUSE_REUSE',
    kind: 'number',
    def: 0.85,
    doc: 'Cosine-similarity floor to auto-offer reuse of an existing artifact (reuseBands.reuse).',
  },
  {
    env: 'AGENT_REUSE_OFFER',
    kind: 'number',
    def: 0.75,
    doc: 'Cosine-similarity floor to mention a close-match artifact exists (reuseBands.offer).',
  },
  {
    env: 'AGENT_JUDGE_MIN_PARAMS',
    kind: 'number',
    def: 24e9,
    doc: 'Minimum param count (approx, billions scale) for a golden-eval judge model.',
  },
  {
    env: 'AGENT_ARCHIVE_IDLE_DAYS',
    kind: 'number',
    def: 30,
    doc: 'Idle-days threshold before a generated artifact is archive-eligible.',
  },
  {
    env: 'AGENT_EVAL_RUNS',
    kind: 'number',
    def: 3,
    doc: 'Judge runs per golden-eval case; passes only on unanimous yes.',
  },

  // --- Resource / hardware budget (src/resource/*) ---
  {
    env: 'AGENT_GPU_BUDGET_FRACTION',
    kind: 'number',
    def: 0.75,
    doc: 'Fraction of total RAM usable as the Metal GPU working set when no live read is available (resource/hardware.ts).',
  },
  {
    env: 'AGENT_FREE_BUDGET_FRACTION',
    kind: 'number',
    def: 0.8,
    doc: 'Fraction of currently-free RAM Ollama will co-load into (resource/hardware.ts).',
  },
  {
    env: 'AGENT_METAL_WORKING_SET_BYTES',
    kind: 'number',
    def: 0,
    doc: 'Optional live-read override (bytes) for the Metal GPU working-set ceiling; 0/unset falls back to the fraction heuristic above.',
  },
  {
    env: 'AGENT_KV_CACHE_TYPE',
    kind: 'string',
    def: 'q8_0',
    doc: "Global Ollama KV-cache quant type (f16|q8_0|q4_0); unrecognized values also fall back to 'q8_0' (resource/kv-cache.ts).",
  },

  // --- Provisioning (src/provisioning/*) ---
  {
    env: 'AGENT_PROVISION_AUTO_YES',
    kind: 'boolean',
    def: false,
    doc: "Non-interactive auto-confirm for model provisioning prompts; real code only checks '1' exactly (cli/provision.ts, cli/chat.ts).",
    strict: true,
  },

  // --- MCP (src/mcp/*) ---
  {
    env: 'AGENT_MCP_AUTO_APPROVE',
    kind: 'boolean',
    def: false,
    doc: "Non-interactive auto-approve for new MCP server consent; real code only checks '1' exactly (mcp/mount.ts).",
    strict: true,
  },
  {
    env: 'AGENT_MCP_CONFIG',
    kind: 'string',
    def: 'mcp.json',
    doc: 'Path to the MCP server registry file; real default resolves relative to cwd (mcp/config.ts).',
  },

  // --- Telemetry (src/telemetry/*) ---
  {
    env: 'AGENT_TELEMETRY_RECORD_IO',
    kind: 'boolean',
    def: true,
    doc: "Record prompts/responses/tool-IO into run spans; '0' disables (telemetry/provider.ts recordIoEnabled).",
  },
  {
    env: 'AGENT_OTLP_ENDPOINT',
    kind: 'string',
    def: '',
    doc: 'OTLP/HTTP trace exporter endpoint; unset = JSONL export only (telemetry/provider.ts buildProcessors).',
  },

  // --- Logging (src/log/logger.ts) ---
  {
    env: 'AGENT_LOG_LEVEL',
    kind: 'string',
    def: 'info',
    doc: 'Logger threshold: debug|info|warn|error.',
  },

  // --- Runs / archive (src/cli/runs.ts, src/cli/archive.ts) ---
  {
    env: 'AGENT_RUNS_ROOT',
    kind: 'string',
    def: 'runs',
    doc: 'Directory for run artifacts/traces.',
  },

  // --- Workflow / DAG (src/workflow/run-step.ts) ---
  {
    env: 'AGENT_WORKFLOW_MAX_PARALLEL',
    kind: 'number',
    def: 2,
    doc: 'Conservative thrash-avoidance cap on parallel map-step branches (per-map overridable).',
  },

  // --- Media (uncensored policy, src/media/policy.ts) ---
  {
    env: 'AGENT_UNCENSORED',
    kind: 'boolean',
    def: true,
    doc: "Allow uncensored models + disable image safety checker; only '0'/'false' turns it off (media/policy.ts uncensoredEnabled).",
  },

  // --- Media: generation timeout (shared across image/audio/video/STT) ---
  {
    env: 'AGENT_MEDIA_TIMEOUT_MS',
    kind: 'number',
    def: 600_000,
    doc: 'Wall-clock cap for a media subprocess (STT/image/TTS/video generation). NOTE: the interactive voice-capture path (voice/cli-io.ts resolveVoiceConfig) reuses this same var but falls back to 30_000ms, not this default, when unset.',
  },

  // --- Media: STT (src/media/audio/transcribe.ts) ---
  {
    env: 'AGENT_STT_CMD',
    kind: 'string',
    def: 'mlx_whisper',
    doc: 'mlx_whisper CLI binary; real default resolves against the installed media venv, falling back to this bare PATH name.',
  },
  {
    env: 'AGENT_STT_MODEL',
    kind: 'string',
    def: 'mlx-community/whisper-large-v3-turbo',
    doc: 'STT model repo for mlx_whisper transcription.',
  },

  // --- Media: image generation (src/media/generate/image-mflux.ts) ---
  {
    env: 'AGENT_IMAGE_CMD',
    kind: 'string',
    def: 'mflux-generate',
    doc: 'mflux-generate CLI binary; real default resolves against the installed media venv, falling back to this bare PATH name.',
  },
  {
    env: 'AGENT_IMAGE_MODEL',
    kind: 'string',
    def: 'dhairyashil/FLUX.1-schnell-mflux-4bit',
    doc: 'Image model repo. Also read as the gen-fit selector env-pin (media/generate/select.ts) — when set there, it is authoritative and bypasses hardware-fit ranking entirely.',
  },
  {
    env: 'AGENT_IMAGE_BASE_MODEL',
    kind: 'string',
    def: 'schnell',
    doc: "mflux --base-model architecture; must match AGENT_IMAGE_MODEL's architecture if overridden.",
  },

  // --- Media: TTS / voice generation (src/media/generate/audio-mlx.ts) ---
  {
    env: 'AGENT_TTS_CMD',
    kind: 'string',
    def: 'mlx_audio.tts.generate',
    doc: 'mlx-audio TTS CLI binary; real default resolves against the installed media venv, falling back to this bare PATH name.',
  },
  {
    env: 'AGENT_VOICE_MODEL',
    kind: 'string',
    def: 'mlx-community/Kokoro-82M-bf16',
    doc: 'Kokoro TTS model repo for generate_speech. Also the gen-fit selector env-pin for audio (media/generate/select.ts).',
  },
  {
    env: 'AGENT_VOICE',
    kind: 'string',
    def: 'af_heart',
    doc: 'Kokoro preset voice id for generate_speech.',
  },

  // --- Media: video generation (src/media/generate/video-mlx.ts) ---
  {
    env: 'AGENT_VIDEO_CMD',
    kind: 'string',
    def: 'mlx_video.ltx_2.generate',
    doc: 'mlx-video LTX CLI binary; real default resolves against the isolated video venv, falling back to this bare PATH name.',
  },
  {
    env: 'AGENT_VIDEO_MODEL',
    kind: 'string',
    def: '',
    doc: "Video model repo gen-fit selector env-pin (media/generate/select.ts); unset lets the selector pick the largest-that-fits catalog entry, or mlx-video's own built-in default when opts.model is also unset.",
  },
  {
    env: 'AGENT_VIDEO_PIPELINE',
    kind: 'string',
    def: 'distilled',
    doc: "LTX video pipeline: 'distilled' (fast few-step) vs 'dev'/'dev-two-stage-hq'.",
  },

  // --- Media: ComfyUI/Wan server lane (src/media/generate/comfy-lane.ts) ---
  {
    env: 'AGENT_COMFY_HOST',
    kind: 'string',
    def: '127.0.0.1',
    doc: 'ComfyUI server host for the shape-only Wan video server lane.',
  },
  {
    env: 'AGENT_COMFY_PORT',
    kind: 'string',
    def: '8188',
    doc: 'ComfyUI server port.',
  },

  // --- Media: venv resolution (src/media/cmd-resolve.ts) ---
  {
    env: 'AGENT_MEDIA_VENV',
    kind: 'string',
    def: '~/.cache/ai/media-venv',
    doc: 'Media (STT/image/TTS) Python venv dir; real default is joined against the live home dir.',
  },
  {
    env: 'AGENT_MEDIA_VIDEO_VENV',
    kind: 'string',
    def: '~/.cache/ai/media-video-venv',
    doc: 'Isolated video-generation Python venv dir (separate transformers version); real default is joined against the live home dir.',
  },

  // --- Voice input / STT (src/voice/*) ---
  {
    env: 'AGENT_VOICE_DIR',
    kind: 'string',
    def: '~/.cache/ai/voice',
    doc: 'Cache dir for downloaded voice-input (sherpa-onnx) models; real default is joined against the live home dir.',
  },
  {
    env: 'AGENT_VOICE_STT_MODEL',
    kind: 'string',
    def: '',
    doc: 'Absolute path to a voice-input STT model dir; unset resolves to <AGENT_VOICE_DIR>/sherpa-onnx-moonshine-tiny-en-int8 (voice/model.ts).',
  },
  {
    env: 'AGENT_FFMPEG_CMD',
    kind: 'string',
    def: 'ffmpeg',
    doc: 'ffmpeg binary for voice capture/decode; bare PATH lookup by default.',
  },
  {
    env: 'AGENT_MIC_INDEX',
    kind: 'string',
    def: '0',
    doc: 'ffmpeg avfoundation mic device index (macOS system default input).',
  },
  {
    env: 'AGENT_VOICE_EXEC',
    kind: 'string',
    def: '',
    doc: "Voice transcriber impl selector; 'subprocess' forces the node stt-worker, anything else (default) runs in-process sherpa-onnx-node (voice/transcribe.ts createTranscriber).",
  },

  // --- Server / web BFF (Slice 30b) ---
  {
    env: 'AGENT_WEB_PORT',
    kind: 'number',
    def: 4130,
    doc: 'Port the local web BFF (bun run web) listens on (server/main.ts). Distinct from Ollama :11434 (bun run serve).',
  },
  {
    env: 'AGENT_WEB_ORIGIN_ALLOWLIST',
    kind: 'string',
    def: 'http://localhost,http://127.0.0.1',
    doc: 'Comma-separated extra allowed Origins beyond localhost/127.0.0.1:PORT; config-driven so a Slice-24 tunnel can add its origin (server/security/origin.ts).',
  },
  {
    env: 'AGENT_WEB_RECORD_IO',
    kind: 'boolean',
    def: false,
    doc: "Record prompt/response IO into spans for SERVED (web) runs; default OFF for served/web mode per the Slice-30b web-perimeter hardening; only '1' enables. Distinct from AGENT_TELEMETRY_RECORD_IO (CLI, default on).",
    strict: true,
  },
  {
    env: 'AGENT_WEB_NOTIFY_POLL_MS',
    kind: 'number',
    def: 5_000,
    doc: 'How often the browser polls GET /api/runs for long-run completion notifications (server/main.ts injects this into the served page; web/src/features/notifications/use-run-notifications.ts reads it). Slice 30b Phase 6.',
  },
  {
    env: 'AGENT_WEB_NOTIFY_MIN_DURATION_MS',
    kind: 'number',
    def: 60_000,
    doc: "Minimum durationMs a completed Crew/Workflow/Agent run must have crossed before a completion notification fires. Spec §7.2's correctness argument depends on this staying well above AGENT_WEB_NOTIFY_POLL_MS (a run cannot both start and finish inside one poll interval, so it is always observed Running at least once before terminal). Slice 30b Phase 6.",
  },
  {
    env: 'AGENT_WEB_VOICE_DEFAULT_MODEL',
    kind: 'string',
    def: 'moonshine-base',
    doc: "Default Moonshine model tier for browser voice input (web/src/features/voice/stt-engine.ts): 'moonshine-base' (~120-150MB, default, better accuracy) or 'moonshine-tiny' (~76MB, faster/lighter). Injected into the served page as window.__AGENT_VOICE_DEFAULT_MODEL__ (server/main.ts renderIndexHtml). Slice 30b Phase 7.",
  },
  {
    env: 'AGENT_WEB_VOICE_VAD_SILENCE_MS',
    kind: 'number',
    def: 800,
    doc: 'Sustained silence (ms) that closes a tap-to-toggle voice segment (web/src/features/voice/vad.ts Segmenter). Injected into the served page as window.__AGENT_VOICE_VAD_SILENCE_MS__ (server/main.ts renderIndexHtml). Slice 30b Phase 7.',
  },
];

/** `Number(x)` succeeds but the same-family `envNumber` helpers in
 *  reliability/verified-build use `|| fallback`, which also rejects `0` and
 *  `NaN`; `coerce` below uses `Number.isFinite` (accepts a real `0` override)
 *  per the Task-2 spec — a deliberate, documented refinement, not a bug. */
function coerce(
  entry: ConfigEntry,
  raw: string | undefined,
): { value: number | boolean | string; source: 'env' | 'default' } {
  if (raw === undefined || raw === '') {
    return { value: entry.def, source: 'default' };
  }
  if (entry.kind === 'number') {
    const n = Number(raw);
    return Number.isFinite(n)
      ? { value: n, source: 'env' }
      : { value: entry.def, source: 'default' };
  }
  if (entry.kind === 'boolean') {
    return {
      value: raw !== '0' && raw.toLowerCase() !== 'false',
      source: 'env',
    };
  }
  return { value: raw, source: 'env' };
}

export type LoadedConfig = {
  values: Record<string, number | boolean | string>;
  sources: Record<string, 'env' | 'default'>;
};

/** Coerces + validates every `CONFIG_SPEC` entry against `env` (defaults to
 *  `process.env`), returning the effective value and where it came from.
 *  An invalid value (e.g. a non-numeric string for a number entry) silently
 *  falls back to the documented default, mirroring the env-fallback-only
 *  convention used across the codebase (`envNumber`, `maxDelegationDepth`, …) —
 *  never throws on bad input. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): LoadedConfig {
  const values: Record<string, number | boolean | string> = {};
  const sources: Record<string, 'env' | 'default'> = {};
  for (const e of CONFIG_SPEC) {
    const { value, source } = coerce(e, env[e.env]);
    values[e.env] = value;
    sources[e.env] = source;
  }
  return { values, sources };
}
