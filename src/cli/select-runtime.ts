import type { BeforeDelegate } from '../core/delegate.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import {
  effectiveKvBytesPerToken,
  f16KvBytesPerToken,
} from '../resource/kv-cache.ts';
import { createModelManager } from '../resource/model-manager.ts';
import {
  getModelKvArch,
  isModelInstalled,
  listLoadedModels,
} from '../resource/ollama-control.ts';
import { createSelectHook } from './select-hook.ts';
import { formatSelectionNotice } from './selection-notice.ts';

/** Live model-selection runtime (manager + offline registry + select-hook)
 *  shared by the flow and crew CLIs. Agent steps / crew members are resolved to
 *  the largest model that fits the live RAM budget at delegation. Mirrors the
 *  inline setup in chat.ts (kept as-is; deduping chat.ts is a follow-up). */
export async function createSelectionRuntime(opts?: {
  pinned?: string[];
}): Promise<{
  onBeforeDelegate: BeforeDelegate;
  capture: ResourceCapture;
  close: () => Promise<void>;
}> {
  const manager = createModelManager();
  const capture: ResourceCapture = {};
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
    ensureReady: (decl, o) => manager.ensureReady(decl, o),
    listLoaded: () => listLoadedModels(),
    pinned: opts?.pinned ?? [],
    capture,
    notify,
  });

  return { onBeforeDelegate, capture, close: () => manager.unloadAll() };
}
