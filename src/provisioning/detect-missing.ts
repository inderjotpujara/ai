import type { ModelDeclaration } from '../core/types.ts';

/** The declared models not yet installed — the set provisioning offers to pull. */
export async function detectMissing(
  declared: ModelDeclaration[],
  isInstalled: (model: string) => Promise<boolean>,
): Promise<ModelDeclaration[]> {
  const missing: ModelDeclaration[] = [];
  for (const d of declared) {
    if (!(await isInstalled(d.model))) missing.push(d);
  }
  return missing;
}
