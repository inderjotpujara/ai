import { createSuperAgent } from '../../agents/super.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { BOOTSTRAP } from '../../models/registry.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { buildProvisionDeps, detectHost } from '../provisioning/cli-deps.ts';
import { detectMissing } from '../provisioning/detect-missing.ts';
import { runProvision } from '../provisioning/provisioner.ts';
import { askYesNo, stdinInput } from '../provisioning/ui/prompt.ts';
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
import { runChat } from './run-chat.ts';
import { createSelectHook } from './select-hook.ts';
import { formatSelectionNotice } from './selection-notice.ts';
import { withMcpRun } from './with-mcp-run.ts';

/** Non-invasive first-boot offer: only fires interactively, and only on explicit consent. */
async function maybeAutoProvision(): Promise<void> {
  if (!(process.stderr.isTTY ?? false)) return;
  const autoYes = process.env.AGENT_PROVISION_AUTO_YES === '1';
  const missing = await detectMissing(BOOTSTRAP, (m) => isModelInstalled(m));
  if (missing.length === 0) return;
  const ok = await askYesNo(
    `${missing.length} required model(s) not installed: ${missing.map((m) => m.model).join(', ')}. Provision now?`,
    { input: stdinInput(), autoYes },
  );
  if (!ok) return;
  const host = await detectHost();
  await runProvision({ autoYes, deps: buildProvisionDeps(host, { autoYes }) });
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim();
  if (task.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<your request>"');
    process.exit(1);
  }

  await maybeAutoProvision();

  const manager = createModelManager();
  // Warm + pin the small router model the orchestrator runs on.
  console.error(`Preparing router model ${qwenRouter.model}...`);
  const routerNumCtx = await manager.ensureReady(qwenRouter, {
    pinned: [qwenRouter.model],
  });
  console.error(
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
  const onBeforeDelegate = createSelectHook({
    registry,
    ensureReady: (decl, opts) => manager.ensureReady(decl, opts),
    listLoaded: () => listLoadedModels(),
    pinned: [qwenRouter.model],
    capture,
    notify,
  });

  try {
    await withMcpRun(
      { runsRoot: 'runs', runId: `run-${process.pid}` },
      async ({ run, reg }) => {
        const orchestrator = createSuperAgent(
          reg.forAgent('file_qa'),
          reg.forAgent('web_fetch'),
          onBeforeDelegate,
        );
        const result = await runChat({
          orchestrator,
          task,
          run,
          routerNumCtx,
          capture,
        });
        if (result.kind === 'answer') {
          console.log(result.text);
        } else if (result.kind === 'gap') {
          console.log(result.message);
        } else {
          console.error(result.message);
          process.exitCode = 1;
        }
      },
    );
  } finally {
    await manager.unloadAll();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
