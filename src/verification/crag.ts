import type { RetrievalResult } from '../memory/types.ts';
import type { VerifyDeps } from './types.ts';
import { CragGrade } from './types.ts';

export async function gradeRetrieval(
  query: string,
  chunks: RetrievalResult[],
  deps: VerifyDeps,
): Promise<CragGrade> {
  const ctx = chunks.map((c) => c.text).join('\n---\n') || '(no chunks)';
  const prompt = `Query: ${query}\n\nRetrieved context:\n${ctx}\n\nIs this context sufficient and relevant to answer the query? Reply with one word: CORRECT, AMBIGUOUS, or INCORRECT.`;
  const raw = (await deps.generate(deps.generalModel, prompt))
    .trim()
    .toLowerCase();
  if (raw.startsWith('correct')) return CragGrade.Correct;
  if (raw.startsWith('incorrect')) return CragGrade.Incorrect;
  return CragGrade.Ambiguous;
}

export async function rewriteQuery(
  query: string,
  deps: VerifyDeps,
): Promise<string> {
  const raw = await deps.generate(
    deps.generalModel,
    `Rewrite this search query to retrieve better evidence. Return ONLY the rewritten query.\n\n${query}`,
  );
  return raw.trim().split('\n')[0]?.trim() || query;
}

export async function correctiveRetrieve(
  query: string,
  recall: (q: string) => Promise<RetrievalResult[]>,
  deps: VerifyDeps,
): Promise<{ query: string; chunks: RetrievalResult[] }> {
  const rewritten = await rewriteQuery(query, deps);
  const chunks = await recall(rewritten);
  return { query: rewritten, chunks };
}
