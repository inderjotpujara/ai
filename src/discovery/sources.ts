import type { CatalogSource } from './catalog-source.ts';
import { hfGgufSource } from './huggingface-gguf.ts';
import { hfMlxSource } from './huggingface-mlx.ts';

export const SOURCES: CatalogSource[] = [hfGgufSource, hfMlxSource];
