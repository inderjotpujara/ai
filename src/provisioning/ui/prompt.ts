/** Minimal line reader so prompts are testable without real stdin. */
export type LineInput = { read: () => Promise<string> };

export function stdinInput(): LineInput {
  return {
    read: () =>
      new Promise((resolve) => {
        const onData = (d: Buffer) => {
          process.stdin.off('data', onData);
          process.stdin.pause();
          resolve(d.toString().trim());
        };
        process.stdin.resume();
        process.stdin.on('data', onData);
      }),
  };
}

export async function askYesNo(
  question: string,
  opts: { input: LineInput; autoYes: boolean },
): Promise<boolean> {
  if (opts.autoYes) return true;
  process.stderr.write(`${question} [y/N] `);
  const ans = (await opts.input.read()).toLowerCase();
  return ans === 'y' || ans === 'yes';
}

/** Present items with a recommended pre-selection; return the chosen subset. */
export async function selectModels<T extends { recommended: boolean }>(
  items: T[],
  opts: { input: LineInput; autoYes: boolean; label: (t: T) => string },
): Promise<T[]> {
  const recommended = items.filter((i) => i.recommended);
  if (opts.autoYes) return recommended;
  items.forEach((it, i) => {
    const mark = it.recommended ? '*' : ' ';
    process.stderr.write(`  [${mark}] ${i + 1}. ${opts.label(it)}\n`);
  });
  process.stderr.write(
    'Select models to download (comma-separated numbers, or Enter for recommended *): ',
  );
  const raw = (await opts.input.read()).trim();
  if (raw === '') return recommended;
  const picked = new Set(
    raw
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10) - 1)
      .filter((n) => n >= 0 && n < items.length),
  );
  return items.filter((_, i) => picked.has(i));
}
