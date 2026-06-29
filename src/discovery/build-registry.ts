import { BOOTSTRAP } from '../../models/registry.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { availableRuntimes } from '../runtime/registry.ts';
import { readCatalog } from './catalog-cache.ts';
import type { Candidate } from './catalog-source.ts';

export type BuildRegistryDeps = {
  bootstrap?: ModelDeclaration[];
  installed?: () => Promise<ModelDeclaration[]>;
  readCatalog?: () => Candidate[] | undefined;
};

async function installedFromRuntimes(): Promise<ModelDeclaration[]> {
  const out: ModelDeclaration[] = [];
  for (const rt of await availableRuntimes()) {
    try {
      for (const m of await rt.control.listLoaded()) {
        out.push({
          provider: rt.kind,
          model: m.name,
          params: {},
          role: 'installed',
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0 },
        });
      }
    } catch {
      /* runtime down → contributes nothing */
    }
  }
  return out;
}

/** OFFLINE-SAFE merge: bootstrap ∪ installed ∪ cached catalog, deduped by (provider,model). */
export async function buildRegistry(
  deps: BuildRegistryDeps = {},
): Promise<ModelDeclaration[]> {
  const bootstrap = deps.bootstrap ?? BOOTSTRAP;
  let installed: ModelDeclaration[] = [];
  try {
    installed = await (deps.installed ?? installedFromRuntimes)();
  } catch {
    installed = [];
  }
  const catalog = (deps.readCatalog ?? (() => readCatalog()))() ?? [];

  const byKey = new Map<string, ModelDeclaration>();
  for (const d of [...bootstrap, ...installed, ...catalog]) {
    const key = `${d.provider}::${d.model}`;
    if (!byKey.has(key)) byKey.set(key, d); // first wins: bootstrap > installed > catalog
  }
  return [...byKey.values()];
}
