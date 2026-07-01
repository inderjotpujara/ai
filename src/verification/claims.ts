import type { Claim, VerifyDeps } from './types.ts';

export function parseCitations(text: string): string[] {
  const out: string[] = [];
  const re = /\[mem:([^\]]+)\]/g;
  let m = re.exec(text);
  while (m !== null) {
    const id = m[1]?.trim();
    if (id && !out.includes(id)) out.push(id);
    m = re.exec(text);
  }
  return out;
}

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : raw)?.trim() ?? raw.trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export async function decomposeClaims(
  answer: string,
  deps: VerifyDeps,
): Promise<Claim[]> {
  const prompt = `Break the ANSWER into atomic factual claims. For each claim, list the memory citation ids it cites, taken ONLY from [mem:<id>] tags that appear with that claim. Return a JSON array of {"text": string, "citedIds": string[]}. No prose.\n\nANSWER:\n${answer}`;
  const raw = await deps.generate(deps.generalModel, prompt);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return [{ text: answer, citedIds: parseCitations(answer) }];
  }
  if (!Array.isArray(parsed))
    return [{ text: answer, citedIds: parseCitations(answer) }];
  return parsed
    .filter(
      (c): c is { text: string; citedIds?: string[] } =>
        !!c &&
        typeof (c as unknown as Record<string, unknown>).text === 'string',
    )
    .map((c) => ({
      text: c.text,
      citedIds: Array.isArray(c.citedIds) ? c.citedIds.map(String) : [],
    }));
}
