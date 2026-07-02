/** Minimal line reader so prompts are testable without real stdin. */
export type LineInput = { read: () => Promise<string> };

export function stdinInput(
  stream: NodeJS.ReadStream = process.stdin,
): LineInput {
  return {
    read: () =>
      new Promise((resolve) => {
        const cleanup = (): void => {
          stream.off('data', onData);
          stream.off('end', onEnd);
        };
        const onData = (d: Buffer): void => {
          cleanup();
          stream.pause();
          resolve(d.toString().trim());
        };
        const onEnd = (): void => {
          cleanup();
          resolve('');
        };
        stream.resume();
        stream.on('data', onData);
        stream.on('end', onEnd);
      }),
  };
}

/** Interactive prompting is safe only when the stream we WRITE the question to
 *  (stderr) and the stream we READ the answer from (stdin) are both TTYs.
 *  Judging on stderr alone lets `cmd < /dev/null` hang on an ended stdin. */
export function interactiveTTY(
  stdin: { isTTY?: boolean } = process.stdin,
  stderr: { isTTY?: boolean } = process.stderr,
): boolean {
  return (stdin.isTTY ?? false) && (stderr.isTTY ?? false);
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
