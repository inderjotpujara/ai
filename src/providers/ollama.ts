import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import type { ModelDeclaration } from '../core/types.ts';

// The provider's baseURL needs the /api suffix (per its own examples).
const OLLAMA_BASE_URL = 'http://localhost:11434/api';

/** Build an AI SDK LanguageModel for an Ollama-backed declaration. */
export function createOllamaModel(decl: ModelDeclaration): LanguageModel {
  const ollama = createOllama({ baseURL: OLLAMA_BASE_URL });
  return ollama(decl.model);
}
