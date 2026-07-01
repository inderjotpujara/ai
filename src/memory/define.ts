import { MemoryError } from '../core/errors.ts';
import type { MemoryConfig } from './types.ts';

const DEFAULT_PATH = 'memory';
const DEFAULT_EMBED = 'qwen3-embedding:0.6b';

export type ResolvedMemoryConfig = { path: string; embedModel: string };

/** Resolve + validate memory config. Env is fallback-only. */
export function defineMemory(config: MemoryConfig = {}): ResolvedMemoryConfig {
  const path = (
    config.path ??
    process.env.AGENT_MEMORY_PATH ??
    DEFAULT_PATH
  ).trim();
  if (!path) throw new MemoryError('memory path must be non-empty');
  const embedModel = (
    config.embedModel ??
    process.env.AGENT_MEMORY_EMBED_MODEL ??
    DEFAULT_EMBED
  ).trim();
  if (!embedModel) throw new MemoryError('embed model must be non-empty');
  return { path, embedModel };
}
