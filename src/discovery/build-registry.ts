import { BOOTSTRAP } from '../../models/registry.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { availableRuntimes, runtimeFor } from '../runtime/registry.ts';
import { readCatalog } from './catalog-cache.ts';
import type { Candidate } from './catalog-source.ts';

export type BuildRegistryDeps = {
  bootstrap?: ModelDeclaration[];
  installed?: () => Promise<ModelDeclaration[]>;
  readCatalog?: () => Candidate[] | undefined;
  /**
   * Probe whether a catalog candidate is installed locally.
   * Defaults to checking via the candidate's runtime control.
   * Throws / offline → treat as NOT installed (candidate excluded).
   */
  isInstalled?: (decl: ModelDeclaration) => Promise<boolean>;
};

async function installedFromRuntimes(): Promise<ModelDeclaration[]> {
  const out: ModelDeclaration[] = [];
  for (const rt of await availableRuntimes()) {
    try {
      for (const m of await rt.control.listLoaded()) {
        out.push({
          runtime: rt.kind,
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

function defaultIsInstalled(decl: ModelDeclaration): Promise<boolean> {
  return runtimeFor(decl.runtime).control.isInstalled(decl.model);
}

async function filterInstalledCatalog(
  catalog: Candidate[],
  probe: (decl: ModelDeclaration) => Promise<boolean>,
): Promise<ModelDeclaration[]> {
  const results: ModelDeclaration[] = [];
  for (const c of catalog) {
    try {
      if (await probe(c)) results.push(c);
    } catch {
      /* runtime offline or throws → exclude candidate */
    }
  }
  return results;
}

/** OFFLINE-SAFE merge: bootstrap ∪ installed ∪ catalog (installed-only), deduped by (runtime,model). */
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
  const rawCatalog = (deps.readCatalog ?? (() => readCatalog()))() ?? [];
  const probe = deps.isInstalled ?? defaultIsInstalled;
  const catalog = await filterInstalledCatalog(rawCatalog, probe);

  const byKey = new Map<string, ModelDeclaration>();
  for (const d of [...bootstrap, ...installed, ...catalog]) {
    const key = `${d.runtime}::${d.model}`;
    if (!byKey.has(key)) byKey.set(key, d); // first wins: bootstrap > installed > catalog
  }
  return [...byKey.values()];
}
