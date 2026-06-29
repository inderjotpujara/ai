import type { ModelDeclaration } from '../src/core/types.ts';
import qwenFast from './qwen-fast.ts';
import qwenRouter from './qwen-router.ts';

/**
 * Bootstrap content of a machine-adaptive capability LADDER. The selector is
 * N-rung capable; the live-budget fits-filter makes any rung inert where it does
 * not fit. Only rungs verified on this hardware ship here; Slice 6 discovery will
 * replace this static array with a per-machine runtime fetch.
 */
export const BOOTSTRAP: ModelDeclaration[] = [qwenRouter, qwenFast];
