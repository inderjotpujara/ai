import { agentNames } from '../../agents/index.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { BOOTSTRAP } from '../../models/registry.ts';
import { liveRemoteDelegateTools } from '../a2a/mount.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import { loadConfig } from '../config/schema.ts';
import { noopEventSink } from '../core/events.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { RuntimeKind } from '../core/types.ts';
import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { handleTopLevel } from '../errors/boundary.ts';
import { createLogger } from '../log/logger.ts';
import { warnUnknownAgents } from '../mcp/mount.ts';
import type { McpConfig } from '../mcp/types.ts';
import type { IngestFlags } from '../media/ingest.ts';
import { createMediaStore } from '../media/store.ts';
import { makeEmbedder } from '../memory/embed.ts';
import { installSignalHandlers, onShutdown } from '../process/lifecycle.ts';
import { buildProvisionDeps, detectHost } from '../provisioning/cli-deps.ts';
import { detectMissing } from '../provisioning/detect-missing.ts';
import { runProvision } from '../provisioning/provisioner.ts';
import {
  askYesNo,
  interactiveTTY,
  stdinInput,
} from '../provisioning/ui/prompt.ts';
import { DegradeKind, formatLedger } from '../reliability/ledger.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import {
  effectiveKvBytesPerToken,
  f16KvBytesPerToken,
} from '../resource/kv-cache.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import {
  getModelKvArch,
  isModelInstalled,
  listLoadedModels,
} from '../resource/ollama-control.ts';
import { newRunId } from '../run/run-id.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { reuseDecision } from '../verified-build/reuse.ts';
import type { CapabilitySignature } from '../verified-build/types.ts';
import { ReuseKind } from '../verified-build/types.ts';
import { createCliVoiceDeps } from '../voice/cli-io.ts';
import { ingestVoice } from '../voice/ingest.ts';
import { makeRealStore } from './memory.ts';
import { shouldOfferCrew } from './offer-crew.ts';
import { runChatSession } from './run-chat-session.ts';
import { createSelectHook } from './select-hook.ts';
import { formatSelectionNotice } from './selection-notice.ts';
import { withMcpRun } from './with-mcp-run.ts';

/** Typo guard for mcp.json's per-entry `agents` field, mirroring flow.ts's
 *  wiring (src/cli/flow.ts): chat's orchestrator (createSuperAgent) covers
 *  every registered specialist via `agentNames()`, the same known-agent set
 *  flow.ts builds from `AGENTS`. Advisory only — never aborts the run. */
export function warnUnknownChatAgents(
  config: McpConfig,
  warn: (msg: string) => void = (m) => console.error(m),
): void {
  warnUnknownAgents(config, agentNames(), warn);
}

export type MaybeAutoProvisionDeps = {
  /** Override the TTY gate for testing; defaults to interactiveTTY(). */
  isTTY?: boolean;
  detectMissing?: typeof detectMissing;
  isModelInstalled?: typeof isModelInstalled;
  askYesNo?: typeof askYesNo;
};

/** Non-invasive first-boot offer: only fires interactively (stdin AND stderr
 *  both TTYs — see interactiveTTY()), and only on explicit consent. Judging
 *  on stderr alone would let `cmd < /dev/null` hang on an ended stdin. */
export async function maybeAutoProvision(
  deps: MaybeAutoProvisionDeps = {},
): Promise<void> {
  const isTTY = deps.isTTY ?? interactiveTTY();
  if (!isTTY) return;
  const detect = deps.detectMissing ?? detectMissing;
  const checkInstalled = deps.isModelInstalled ?? isModelInstalled;
  const ask = deps.askYesNo ?? askYesNo;
  const autoYes = process.env.AGENT_PROVISION_AUTO_YES === '1';
  const missing = await detect(BOOTSTRAP, (m) => checkInstalled(m));
  if (missing.length === 0) return;
  const ok = await ask(
    `${missing.length} required model(s) not installed: ${missing.map((m) => m.model).join(', ')}. Provision now?`,
    { input: stdinInput(), autoYes },
  );
  if (!ok) return;
  const host = await detectHost();
  await runProvision({ autoYes, deps: buildProvisionDeps(host, { autoYes }) });
}

/** Best-effort reuse hint text for a need against the registry manifests, or
 *  undefined when nothing lands in the Offer/Reuse bands. Informational only —
 *  it never gates the build offers that follow.
 *  TODO(reuse-hint): this uses a purpose-only signature (the raw need text)
 *  rather than signatureFromNeed(), which would distill tools/roles via an
 *  extra LLM call — too heavy before the user has consented to a build. */
export async function reuseHintText(
  need: string,
  embed: (t: string[]) => Promise<number[][]>,
  dirs: readonly string[] = ['agents', 'crews', 'workflows'],
): Promise<string | undefined> {
  const sig: CapabilitySignature = {
    purpose: need,
    tools: [],
    modelTier: '',
    io: '',
    roles: [],
  };
  let best: { match: string; similarity: number } | undefined;
  for (const dir of dirs) {
    const decision = await reuseDecision(sig, { embed, dir });
    if (decision.kind === ReuseKind.Generate) continue;
    if (decision.match === undefined) continue;
    if (best === undefined || decision.similarity > best.similarity) {
      best = { match: decision.match, similarity: decision.similarity };
    }
  }
  if (best === undefined) return undefined;
  const pct = Math.round(best.similarity * 100);
  return `💡 An existing ${best.match} looks similar (${pct}%) — you may not need a new one.`;
}

/** Split value-taking media flags (`--image/--audio/--video/--voice-in <path>`,
 *  repeatable) and the boolean flags `--paste`/`--voice` out of the positional
 *  args, mirroring crew.ts's `parseArgs`. Everything else stays positional
 *  (joined back into the raw prompt by the caller). */
export function parseMediaArgs(argv: string[]): {
  positional: string[];
  flags: IngestFlags;
} {
  const positional: string[] = [];
  const flags: IngestFlags = {
    images: [],
    audios: [],
    videos: [],
    paste: false,
    voice: false,
    voiceIn: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--image' || arg === '--audio' || arg === '--video') {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined) continue;
      if (arg === '--image') flags.images.push(value);
      else if (arg === '--audio') flags.audios.push(value);
      else flags.videos.push(value);
    } else if (arg === '--voice-in') {
      const value = argv[i + 1];
      i += 1;
      if (value !== undefined) flags.voiceIn.push(value);
    } else if (arg === '--voice') {
      flags.voice = true;
    } else if (arg === '--paste') {
      flags.paste = true;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function hasMediaFlags(flags: IngestFlags): boolean {
  return (
    flags.images.length > 0 ||
    flags.audios.length > 0 ||
    flags.videos.length > 0 ||
    flags.paste ||
    flags.voice ||
    flags.voiceIn.length > 0
  );
}

async function main(): Promise<void> {
  // Validates the environment eagerly (today's per-module reads are lazy).
  // Never throws — an invalid AGENT_* value falls back to its documented
  // default, same convention as the rest of the codebase.
  loadConfig();
  installSignalHandlers();

  const { positional, flags } = parseMediaArgs(process.argv.slice(2));
  const rawPrompt = positional.join(' ').trim();
  if (rawPrompt.length === 0 && !hasMediaFlags(flags)) {
    console.error(
      'Usage: bun run src/cli/chat.ts "<your request>" [--image path] [--audio path] [--video path] [--paste] [--voice] [--voice-in path]',
    );
    process.exit(1);
  }

  await maybeAutoProvision();

  const log = createLogger('chat');
  const manager = createModelManager();
  onShutdown(() => manager.unloadAll());
  // Warm + pin the small router model the orchestrator runs on.
  log.info(`Preparing router model ${qwenRouter.model}...`);
  const routerNumCtx = await manager.ensureReady(qwenRouter, {
    pinned: [qwenRouter.model],
  });
  log.info(
    isProjectStoreActive()
      ? 'Using project-local models from ./model-images'
      : '⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.',
  );

  // Capture seam: a genuine no-fit during delegation is recorded here and surfaced
  // by runOrchestrator as kind:'resource' instead of being swallowed.
  const capture: ResourceCapture = {};

  // Announce each NEW model decision (size, context, footprint, install state) once.
  const announced = new Set<string>();
  const notify = async (
    decl: ModelDeclaration,
    numCtx: number,
  ): Promise<void> => {
    if (announced.has(decl.model)) return;
    announced.add(decl.model);
    const [installed, budget, arch] = await Promise.all([
      isModelInstalled(decl.model),
      liveBudgetBytes(),
      getModelKvArch(decl.model).catch(() => undefined),
    ]);
    const f16 = arch
      ? f16KvBytesPerToken(arch)
      : (decl.footprint.kvBytesPerToken ?? 131072);
    const kvBytesPerToken = effectiveKvBytesPerToken(f16);
    console.error(
      formatSelectionNotice({
        decl,
        numCtx,
        kvBytesPerToken,
        budgetBytes: budget,
        installed,
      }),
    );
  };

  const registry = await buildRegistry();
  // READ-only recall benefit for the CLI (D5): the CLI never writes to the
  // `chat` memory space (it has no sessionId to namespace an auto-ingest
  // write under — see run-chat-session.ts's CHAT_MEMORY_SPACE doc comment),
  // but `runChatSession`'s `injectRecall` call benefits identically to the
  // server whenever a memoryStore is present. Construction is cheap +
  // synchronous (mirrors src/server/main.ts's own construction discipline).
  const { store: memoryStore, manager: memoryManager } = makeRealStore({});

  try {
    await withMcpRun(
      { runsRoot: 'runs', runId: newRunId() },
      async ({ run, reg, config, ledger }) => {
        const onBeforeDelegate = createSelectHook({
          registry,
          ensureReady: (decl, opts) => manager.ensureReady(decl, opts),
          listLoaded: () => listLoadedModels(),
          pinned: [qwenRouter.model],
          capture,
          notify,
          log: (message) => console.error(message),
          ledger,
        });
        try {
          warnUnknownChatAgents(config);
          const store = createMediaStore(run.dir);

          // Voice runs BEFORE media ingest so its transcript(s) splice into
          // the prompt text that ingestMedia then scans for dragged-in paths
          // and `--image`/`--audio`/`--video` flags — typed prompt + voice
          // transcript + media all compose into one `task`. Only spun up
          // when a voice flag is present: building real deps loads the
          // sherpa-onnx transcriber, which a plain text/media chat shouldn't
          // pay for.
          let promptWithVoice = rawPrompt;
          if (flags.voice || flags.voiceIn.length > 0) {
            // Deps construction AND ingestVoice share one try/catch: building
            // real deps synchronously loads the sherpa-onnx addon and
            // constructs its recognizer (createCliVoiceDeps -> createTranscriber
            // -> createInProcessTranscriber), which throws before ingestVoice's
            // own internal degrade-to-warning logic ever runs — e.g. the voice
            // model hasn't been downloaded yet, or the addon fails to load.
            // Any failure here must degrade to the original (non-voice) prompt
            // rather than aborting the whole chat turn.
            let voiceDeps: ReturnType<typeof createCliVoiceDeps> | undefined;
            try {
              voiceDeps = createCliVoiceDeps(ledger);
              const voiceResult = await ingestVoice(
                rawPrompt,
                flags,
                voiceDeps,
              );
              promptWithVoice = voiceResult.prompt;
              // ingestVoice's warnings are already prefixed ("voice: ...").
              for (const warning of voiceResult.warnings) {
                console.error(warning);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(
                `voice: unavailable (${message}) — run 'bun run setup:voice' to install the model`,
              );
              ledger?.record({
                kind: DegradeKind.ToolSkipped,
                subject: 'voice',
                reason: message,
              });
            } finally {
              await voiceDeps?.transcriber.close();
            }
          }

          const {
            result,
            warnings,
            task: ingestedTask,
          } = await runChatSession({
            task: promptWithVoice,
            media: flags,
            events: noopEventSink, // CLI keeps its existing notify-based model announcements; a console event sink would double-print
            deps: {
              registry: reg,
              selectHook: onBeforeDelegate,
              capture,
              run,
              ledger,
              routerNumCtx,
              mediaStore: store,
              memoryStore,
              // Slice 31 (Task 29b): mount every configured A2A remote as a
              // `delegate_to_<name>` orchestrator delegate for this turn. Flag-
              // gated + fresh-read inside the helper (off ⇒ `{}`, no change);
              // peers are contacted only on actual delegate invocation.
              remoteTools: liveRemoteDelegateTools({
                warn: (m) => console.error(m),
              }),
              onRemoteWarn: (m) => console.error(m),
            },
          });
          for (const warning of warnings) console.error(`media: ${warning}`);
          // `ingestedTask` is the FINAL, post-media-ingestion prompt (markers
          // spliced in, transcripts appended) — the exact string the pre-refactor
          // post-`ingestMedia` `task` carried. The gap branch below seeds the
          // reuse-hint and crew/agent builders from it so behaviour is byte-exact.
          if (result.kind === 'answer') {
            console.log(result.text);
          } else if (result.kind === 'gap') {
            console.log(result.message);
            // Reuse hint before any build offer: if a manifest entry already
            // looks similar, say so. Guarded on the embed model being installed
            // (never speculatively pull) and best-effort (never blocks the flow).
            try {
              const embedModel =
                process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
              if (await isModelInstalled(embedModel)) {
                const embedder = makeEmbedder({
                  ensureReady: (d) => manager.ensureReady(d),
                  control: runtimeFor(RuntimeKind.Ollama).control,
                  model: embedModel,
                });
                const hint = await reuseHintText(
                  `${result.missingCapability} ${ingestedTask}`,
                  embedder.embed,
                );
                if (hint !== undefined) console.log(hint);
              }
            } catch {
              // Hint is informational only; an embed failure must not block the offers.
            }
            if (
              interactiveTTY() &&
              shouldOfferCrew(`${result.missingCapability} ${ingestedTask}`)
            ) {
              const wantsCrew = await askYesNo(
                `This looks multi-step. Propose a crew/workflow for "${result.missingCapability}"?`,
                { input: stdinInput(), autoYes: false },
              );
              if (wantsCrew) {
                const { deps, cleanup } = await makeRealCrewBuilderDeps();
                try {
                  const built = await buildCrewOrWorkflow(
                    `${result.missingCapability}. Original task: ${ingestedTask}`,
                    deps,
                  );
                  if (built.kind === 'written') {
                    console.log(
                      `Created ${built.shape} "${built.name}" — re-run to use it.`,
                    );
                  }
                } finally {
                  await cleanup();
                }
                return;
              }
            }
            if (interactiveTTY()) {
              const wants = await askYesNo(
                `Propose a new agent for "${result.missingCapability}"?`,
                { input: stdinInput(), autoYes: false },
              );
              if (wants) {
                const { deps, cleanup } = await makeRealBuilderDeps();
                try {
                  const built = await buildAgent(
                    `${result.missingCapability}. Original task: ${ingestedTask}`,
                    deps,
                  );
                  if (built.kind === 'written') {
                    console.log(
                      `Created "${built.proposal.name}" — re-run your task to use it.`,
                    );
                  }
                } finally {
                  await cleanup();
                }
              }
            }
          } else {
            console.error(result.message);
            process.exitCode = 1;
          }
        } finally {
          const summary = formatLedger(ledger);
          if (summary) console.error(summary);
        }
      },
    );
  } finally {
    await manager.unloadAll();
    await memoryManager.unloadAll();
    memoryStore.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    process.exit(handleTopLevel(err));
  });
}
