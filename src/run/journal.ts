import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type JournalEntry = { step: string; data?: unknown };
type StoredEntry = JournalEntry & { index: number };

function journalPath(dir: string): string {
  return join(dir, 'journal.jsonl');
}

/** Append one entry as a JSON line, stamped with the next index. */
export async function appendJournal(
  dir: string,
  entry: JournalEntry,
): Promise<void> {
  const existing = await readJournal(dir);
  const stored: StoredEntry = { index: existing.length, ...entry };
  await appendFile(journalPath(dir), `${JSON.stringify(stored)}\n`);
}

/** Read all entries in order; empty array if the journal does not exist yet. */
export async function readJournal(dir: string): Promise<StoredEntry[]> {
  let raw: string;
  try {
    raw = await readFile(journalPath(dir), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StoredEntry);
}
