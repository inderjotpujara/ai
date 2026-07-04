/**
 * Resolves the on-disk root for provisioned model weights.
 * Precedence: HF_HOME (HuggingFace cache convention) > OLLAMA_MODELS (Ollama's
 * own env var, reused as a fallback root) > a local `model-images` dir under
 * cwd. Env vars are fallback-only, never hardcoded budgets/paths.
 */
export function resolveDestDir(): string {
  return (
    process.env.HF_HOME ??
    process.env.OLLAMA_MODELS ??
    `${process.cwd()}/model-images`
  );
}
